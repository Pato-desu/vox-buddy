// Bot entry point: `npm start`. Needs .env (see SETUP.md) and the speech sidecar running.
import { getVoiceConnection, type AudioPlayer } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits, REST, Routes, type Guild, type VoiceBasedChannel } from 'discord.js';
import { createGenAiTransport } from './brain/gemini.js';
import { ConversationMemory } from './brain/memory.js';
import { GeminiLlm } from './brain/llm.js';
import { commandDefs } from './commands.js';
import { createLogger, parseLogLevel } from './log.js';
import { loadEnv, redact, tuning } from './config.js';
import { TranscriptMirror } from './mirror.js';
import { AloneWatcher } from './voice/alone.js';
import { PersonaStore } from './persona.js';
import { SettingsStore } from './settings.js';
import { LatencyRecorder } from './pipeline/metrics.js';
import { formatStatus } from './status.js';
import { UsageTracker, formatUsage } from './usage.js';
import { startSession } from './session.js';
import { createGeminiLiveConnector } from './live/gemini-live.js';
import { startLiveSession } from './live/session.js';
import { DiscordStreamSink, StreamOutput } from './live/stream-output.js';
import { SidecarClient } from './speech/client.js';
import { formatVoices, scanVoices } from './voices.js';
import { VoiceTts } from './speech/voice.js';
import { ManagedConnection, createDiscordJoiner } from './voice/connection.js';
import { DiscordSink } from './voice/discord-sink.js';
import { PlaybackQueue } from './voice/playback.js';
import { SwitchableReceiver, adaptReceiver } from './voice/receive.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* fall back to the real environment */
}
const env = loadEnv();
const logger = createLogger({ level: parseLogLevel(process.env.LOG_LEVEL), secrets: [env.discordToken, env.googleApiKey] });
logger.info(`starting: token ${redact(env.discordToken)}, guild ${env.guildId}`);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const sidecar = new SidecarClient({ baseUrl: process.env.SIDECAR_URL ?? 'http://127.0.0.1:8765' });
const persona = new PersonaStore('persona.md', tuning.botName);
export const settings = new SettingsStore('settings.json');
let cloneReady = false;
const refreshClone = async (): Promise<void> => void (cloneReady = Boolean((await sidecar.health()).clone));
const tts = new VoiceTts({ backend: sidecar, settings: () => settings.get(), cloneReady: () => cloneReady, log: (m) => logger.info(m) });
const mirror = new TranscriptMirror({
  post: async (text) => {
    const id = settings.get().mirrorChannelId;
    const ch = id ? await client.channels.fetch(id) : null;
    if (ch?.isSendable()) await ch.send({ content: text, allowedMentions: { parse: [] } });
  },
  onError: (e) => logger.warn(`mirror post failed: ${e.message}`),
});
const usage = new UsageTracker({ load: () => settings.get().usage, save: (d) => void settings.update({ usage: d }) });

const makeLlm = (memory: ConversationMemory) =>
  new GeminiLlm({
    onUsage: (u) => usage.record(u),
    history: () => memory.history(),
    transport: createGenAiTransport(env.googleApiKey),
    model: tuning.geminiModel,
    temperature: tuning.geminiTemperature,
    persona: () => persona.get(),
    blockedLine: "Ha, I'm going to skip that one.",
    errorLine: 'Sorry, my brain glitched. Say that again?',
    lines: {
      rate_limit: "Whoa, I'm getting too many thoughts at once. Give me a few seconds.",
      server: 'My brain is having a rough moment. Try me again in a bit.',
      auth: "I can't reach my brain at all. Someone needs to check my API key.",
    },
  });

interface Active {
  session: { setHushed(on: boolean): void; readonly hushed: boolean };
  /** Live mode only: hangs up the cloud session. */
  close?: () => void;
  latency: LatencyRecorder;
  channelName: string;
  managed: ManagedConnection;
  sink: { player: AudioPlayer };
  channelId: string;
  alone: AloneWatcher;
}
const active = new Map<string, Active>();

/** Leaves a guild's call and frees everything tied to it (timers, playback, reconnect logic). */
function teardown(guildId: string): boolean {
  const a = active.get(guildId);
  if (!a) return false;
  active.delete(guildId);
  a.alone.stop();
  a.session.setHushed(true); // cuts any reply in progress
  a.close?.();
  a.managed.leave();
  return true;
}

/** Humans (not bots) currently in the bot's channel. */
function humansIn(guildId: string, channelId: string): number {
  const ch = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
  return ch?.isVoiceBased() ? ch.members.filter((m) => !m.user.bot).size : 0;
}

client.on(Events.VoiceStateUpdate, (oldS, newS) => {
  for (const id of new Set([oldS.channelId, newS.channelId])) {
    const a = [...active.entries()].find(([, v]) => v.channelId === id);
    if (a && id) a[1].alone.humansPresent(humansIn(a[0], id));
  }
});

client.once(Events.ClientReady, async (c) => {
  const rest = new REST().setToken(env.discordToken);
  await rest.put(Routes.applicationCommands(c.user.id), { body: [] }); // drop stale global commands that show up as duplicates next to the guild ones
  await rest.put(Routes.applicationGuildCommands(c.user.id, env.guildId), { body: commandDefs });
  await refreshClone();
  settings.update({ mirrorChannelId: null }); // transcript mirroring is opt-in per run, never silently resumed after a restart
  const autoId = settings.get().autoJoinChannelId;
  if (autoId) {
    try {
      const ch = await c.channels.fetch(autoId);
      if (ch?.isVoiceBased() && ch.guildId === env.guildId) joinVoice(ch.guild, ch);
    } catch (e) {
      logger.warn(`auto-join failed: ${(e as Error).message}`);
    }
  }
  logger.info(`ready as ${c.user.tag}; slash commands registered`);
});

/** Joins synchronously (no awaits), so two quick /join or /leave commands can't interleave and leak a session. */
function joinVoice(guild: Guild, channel: VoiceBasedChannel): void {
  teardown(guild.id);
  const live = settings.get().mode === 'live';
  const liveSink = live ? new DiscordStreamSink() : null;
  const sink = liveSink ?? new DiscordSink();
  const receiver = new SwitchableReceiver();
  const managed = new ManagedConnection(
    { guildId: guild.id, channelId: channel.id },
    {
      join: createDiscordJoiner({ adapterFor: () => guild.voiceAdapterCreator }),
      log: (m) => logger.info(m),
      // After every (re)join, point the session at the new receiver and re-subscribe the player.
      onConnection: (conn) => {
        receiver.set(adaptReceiver((conn as unknown as { receiver: Parameters<typeof adaptReceiver>[0] }).receiver));
        getVoiceConnection(guild.id)?.subscribe(sink.player);
      },
      onGiveUp: () => {
        logger.error('voice: could not reconnect; use /join again');
        teardown(guild.id);
      },
      onKicked: () => {
        logger.info('removed from the voice channel; staying out until /join');
        teardown(guild.id);
      },
    },
  );
  managed.start();
  const resolveSpeaker = (id: string) => {
    const m = guild.members.cache.get(id);
    return m ? { userId: id, userName: m.displayName, isBot: m.user.bot || id === client.user?.id } : undefined;
  };
  const onTurn = (who: string, heard: string, said: string): void => void (settings.get().mirrorChannelId && mirror.turn(who, heard, said));
  const latency = new LatencyRecorder();
  let session: Active['session'];
  let close: (() => void) | undefined;
  if (liveSink) {
    const handle = startLiveSession({
      receiver,
      connect: createGeminiLiveConnector(env.googleApiKey),
      output: new StreamOutput(liveSink),
      capture: tuning,
      model: tuning.liveModel,
      voice: tuning.liveVoice,
      persona: () => persona.get(),
      resolveSpeaker,
      bargeIn: tuning.bargeInMode,
      leave: { phrase: tuning.leavePhrase },
      onLeave: () => teardown(guild.id),
      onTurn,
      log: (m) => logger.info(m),
      debug: (m) => logger.debug(m),
    });
    session = handle;
    close = handle.close;
  } else {
    const memory = new ConversationMemory(tuning.historyTurns);
    session = startSession({
      memory,
      latency,
      replyWordHardCap: tuning.replyWordHardCap,
      receiver,
      stt: sidecar,
      tts,
      llm: makeLlm(memory),
      player: new PlaybackQueue(sink as DiscordSink),
      capture: tuning,
      minSentenceChars: tuning.ttsSentenceMinChars,
      botTurnGapMs: tuning.botTurnGapMs,
      hearingErrorLine: "Sorry, I can't hear properly right now.",
      bargeIn: tuning.bargeInMode,
      leave: { phrase: tuning.leavePhrase, farewell: tuning.leaveFarewell },
      onLeave: () => teardown(guild.id),
      resolveSpeaker,
      log: (m) => logger.info(m),
      debug: (m) => logger.debug(m),
      onTurn,
    });
  }
  const alone = new AloneWatcher({ afterMs: tuning.autoLeaveAloneS * 1000, onLeave: () => (logger.info('alone for too long, leaving'), teardown(guild.id)) });
  active.set(guild.id, { alone, managed, sink, session, ...(close && { close }), latency, channelName: channel.name, channelId: channel.id });
  alone.humansPresent(humansIn(guild.id, channel.id));
  session.setHushed(settings.get().hushed);
}

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || !i.guild) return;
  const guild = i.guild;
  try {
    if (i.commandName === 'join') {
      const channel = guild.members.cache.get(i.user.id)?.voice.channel ?? (await guild.members.fetch(i.user.id)).voice.channel;
      if (!channel) return void (await i.reply({ content: 'Join a voice channel first.', ephemeral: true }));
      joinVoice(guild, channel);
      await i.reply(`Joined ${channel.name}. Just talk.`);
    } else if (i.commandName === 'mode') {
      const which = i.options.getString('which', true) === 'live' ? 'live' : 'classic';
      settings.update({ mode: which });
      const a = active.get(guild.id);
      const channel = a ? guild.channels.cache.get(a.channelId) : null;
      if (channel?.isVoiceBased()) joinVoice(guild, channel); // switch now: rejoin the same channel in the new mode
      const where = which === 'live' ? `Live mode (${tuning.liveModel}): Gemini in the cloud hears and speaks. Heads up: this sends the call's audio to Google.` : 'Classic mode: speech is processed on this PC and only text goes to Gemini.';
      await i.reply({ content: `${where}${channel ? ' Rejoined to switch.' : ' Applies on the next /join.'}`, ephemeral: true });
    } else if (i.commandName === 'persona') {
      persona.reload();
      await i.reply({ content: 'Persona reloaded.', ephemeral: true });
    } else if (i.commandName === 'voice') {
      const which = i.options.getString('which', true) === 'clone' ? 'clone' : 'fast';
      settings.update({ voice: which });
      await refreshClone();
      if (which === 'clone') void sidecar.warmup(settings.get().cloneSample); // load the model now, not on the first sentence
      const note = which === 'clone' && !cloneReady ? " The clone voice isn't ready yet, so I'll use the fast voice for now." : '';
      await i.reply({ content: `Voice set to ${which}.${note}`, ephemeral: true });
    } else if (i.commandName === 'voices') {
      const samples = scanVoices('voices');
      if (i.options.getSubcommand() === 'use') {
        const name = i.options.getString('name', true);
        const found = samples.find((s) => s.name === name);
        if (!found?.ok) return void (await i.reply({ content: found ? `${name} is unusable: ${found.problem}` : `No sample called ${name}.\n${formatVoices(samples, settings.get().cloneSample)}`, ephemeral: true }));
        settings.update({ voice: 'clone', cloneSample: name });
        await refreshClone();
        void sidecar.warmup(name);
        await i.reply({ content: `Cloning ${name}.${cloneReady ? '' : " The clone engine isn't up yet, so I'll use the fast voice meanwhile."}`, ephemeral: true });
      } else {
        await i.reply({ content: formatVoices(samples, settings.get().cloneSample), ephemeral: true });
      }
    } else if (i.commandName === 'mirror') {
      if (i.options.getSubcommand() === 'on') {
        settings.update({ mirrorChannelId: i.channelId });
        await i.reply({ content: 'Mirroring heard/said lines here. They are public to this channel; /mirror off stops it.' });
      } else {
        settings.update({ mirrorChannelId: null });
        await i.reply({ content: 'Mirror off.', ephemeral: true });
      }
    } else if (i.commandName === 'autojoin') {
      if (i.options.getSubcommand() === 'here') {
        const ch = guild.members.cache.get(i.user.id)?.voice.channel ?? (await guild.members.fetch(i.user.id)).voice.channel;
        if (!ch) return void (await i.reply({ content: 'Join a voice channel first.', ephemeral: true }));
        settings.update({ autoJoinChannelId: ch.id });
        await i.reply({ content: `I'll join ${ch.name} whenever I start.`, ephemeral: true });
      } else {
        settings.update({ autoJoinChannelId: null });
        await i.reply({ content: 'Auto-join off.', ephemeral: true });
      }
    } else if (i.commandName === 'hush') {
      const a = active.get(guild.id);
      if (!a) return void (await i.reply({ content: "I'm not in a voice channel.", ephemeral: true }));
      const state = i.options.getString('state');
      a.session.setHushed(state ? state === 'on' : !a.session.hushed);
      settings.update({ hushed: a.session.hushed });
      await i.reply({ content: a.session.hushed ? 'Hushed. I still listen; `/hush off` to talk again.' : "I'm back.", ephemeral: true });
    } else if (i.commandName === 'status') {
      const a = active.get(guild.id);
      await i.deferReply({ ephemeral: true });
      const sidecarHealth = await sidecar.health();
      await i.editReply(
        formatStatus({ channelName: a?.channelName ?? null, hushed: a?.session.hushed ?? false, settings: settings.get(), liveModel: tuning.liveModel, sidecar: sidecarHealth, latency: a?.latency.summary() ?? null, gpu: sidecarHealth.gpu ?? null, effectiveVoice: tts.effectiveVoice }),
      );
    } else if (i.commandName === 'usage') {
      await i.reply({ content: formatUsage(usage.snapshot(), tuning.geminiModel, { requestsPerDay: tuning.geminiRequestsPerDay, requestsPerMinute: tuning.geminiRequestsPerMinute }), ephemeral: true });
    } else if (i.commandName === 'leave') {
      const left = teardown(guild.id);
      await i.reply({ content: left ? 'Bye!' : "I'm not in a voice channel.", ephemeral: !left });
    }
  } catch (e) {
    logger.error(`command failed: ${(e as Error).message}`);
    if (!i.replied) await i.reply({ content: 'Something went wrong. Check the console.', ephemeral: true }).catch(() => {});
  }
});

process.on('unhandledRejection', (e) => logger.error(`unhandled rejection: ${(e as Error)?.message ?? String(e)}`));
await client.login(env.discordToken);
