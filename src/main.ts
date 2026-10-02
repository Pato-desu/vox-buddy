// Bot entry point: `npm start`. Needs .env (see SETUP.md) and the speech sidecar running.
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { createGenAiTransport } from './brain/gemini.js';
import { ConversationMemory } from './brain/memory.js';
import { GeminiLlm } from './brain/llm.js';
import { commandDefs } from './commands.js';
import { loadEnv, redact, tuning } from './config.js';
import { PersonaStore } from './persona.js';
import { SettingsStore } from './settings.js';
import { LatencyRecorder } from './pipeline/metrics.js';
import { formatStatus } from './status.js';
import { startSession, type SessionHandle } from './session.js';
import { SidecarClient } from './speech/client.js';
import { VoiceTts } from './speech/voice.js';
import { ManagedConnection, createDiscordJoiner } from './voice/connection.js';
import { DiscordSink } from './voice/discord-sink.js';
import { PlaybackQueue } from './voice/playback.js';
import { adaptReceiver } from './voice/receive.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* fall back to the real environment */
}
const env = loadEnv();
console.log(`starting: token ${redact(env.discordToken)}, guild ${env.guildId}`);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const sidecar = new SidecarClient({ baseUrl: process.env.SIDECAR_URL ?? 'http://127.0.0.1:8765' });
const persona = new PersonaStore('persona.md', tuning.botName);
export const settings = new SettingsStore('settings.json');
let cloneReady = false;
const refreshClone = async (): Promise<void> => void (cloneReady = Boolean((await sidecar.health()).clone));
const tts = new VoiceTts({ backend: sidecar, settings: () => settings.get(), cloneReady: () => cloneReady, log: (m) => console.log(m) });
const makeLlm = (memory: ConversationMemory) =>
  new GeminiLlm({
    history: () => memory.history(),
    transport: createGenAiTransport(env.googleApiKey),
    model: tuning.geminiModel,
    temperature: tuning.geminiTemperature,
    persona: () => persona.get(),
    blockedLine: "Ha, I'm going to skip that one.",
    errorLine: 'Sorry, my brain glitched. Say that again?',
  });

interface Active {
  session: SessionHandle;
  latency: LatencyRecorder;
  channelName: string;
  managed: ManagedConnection;
  sink: DiscordSink;
  channelId: string;
}
const active = new Map<string, Active>();

client.once(Events.ClientReady, async (c) => {
  await new REST().setToken(env.discordToken).put(Routes.applicationGuildCommands(c.user.id, env.guildId), { body: commandDefs });
  await refreshClone();
  console.log(`ready as ${c.user.tag}; slash commands registered`);
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || !i.guild) return;
  const guild = i.guild;
  try {
    if (i.commandName === 'join') {
      const channel = guild.members.cache.get(i.user.id)?.voice.channel ?? (await guild.members.fetch(i.user.id)).voice.channel;
      if (!channel) return void (await i.reply({ content: 'Join a voice channel first.', ephemeral: true }));
      active.get(guild.id)?.managed.leave();
      const managed = new ManagedConnection(
        { guildId: guild.id, channelId: channel.id },
        { join: createDiscordJoiner({ adapterFor: () => guild.voiceAdapterCreator }), log: (m) => console.log(m) },
      );
      const conn = managed.start();
      const sink = new DiscordSink();
      const raw = (conn as unknown as { receiver: Parameters<typeof adaptReceiver>[0] }).receiver;
      // Subscribe the player to the connection through the library's own connection object.
      const { getVoiceConnection } = await import('@discordjs/voice');
      getVoiceConnection(guild.id)?.subscribe(sink.player);
      const memory = new ConversationMemory(tuning.historyTurns);
      const latency = new LatencyRecorder();
      const session = startSession({
        memory,
        latency,
        replyWordHardCap: tuning.replyWordHardCap,
        receiver: adaptReceiver(raw),
        stt: sidecar,
        tts,
        llm: makeLlm(memory),
        player: new PlaybackQueue(sink),
        capture: tuning,
        minSentenceChars: tuning.ttsSentenceMinChars,
        botTurnGapMs: tuning.botTurnGapMs,
        bargeIn: tuning.bargeInMode,
        resolveSpeaker: (id) => {
          const m = guild.members.cache.get(id);
          return m ? { userId: id, userName: m.displayName, isBot: m.user.bot || id === client.user?.id } : undefined;
        },
        log: (m) => console.log(m),
      });
      active.set(guild.id, { managed, sink, session, latency, channelName: channel.name, channelId: channel.id });
      await i.reply(`Joined ${channel.name}. Just talk.`);
    } else if (i.commandName === 'persona') {
      persona.reload();
      await i.reply({ content: 'Persona reloaded.', ephemeral: true });
    } else if (i.commandName === 'voice') {
      const which = i.options.getString('which', true) === 'clone' ? 'clone' : 'fast';
      settings.update({ voice: which });
      await refreshClone();
      const note = which === 'clone' && !cloneReady ? " The clone voice isn't ready yet, so I'll use the fast voice for now." : '';
      await i.reply({ content: `Voice set to ${which}.${note}`, ephemeral: true });
    } else if (i.commandName === 'hush') {
      const a = active.get(guild.id);
      if (!a) return void (await i.reply({ content: "I'm not in a voice channel.", ephemeral: true }));
      a.session.setHushed(!a.session.hushed);
      await i.reply({ content: a.session.hushed ? 'Hushed. I still listen; /hush again to talk.' : "I'm back.", ephemeral: true });
    } else if (i.commandName === 'status') {
      const a = active.get(guild.id);
      await i.deferReply({ ephemeral: true });
      const sidecarHealth = await sidecar.health();
      await i.editReply(
        formatStatus({ channelName: a?.channelName ?? null, hushed: a?.session.hushed ?? false, settings: settings.get(), sidecar: sidecarHealth, latency: a?.latency.summary() ?? null }),
      );
    } else if (i.commandName === 'leave') {
      const a = active.get(guild.id);
      a?.managed.leave();
      active.delete(guild.id);
      await i.reply({ content: a ? 'Bye!' : "I'm not in a voice channel.", ephemeral: !a });
    }
  } catch (e) {
    console.error('command failed:', (e as Error).message);
    if (!i.replied) await i.reply({ content: 'Something went wrong. Check the console.', ephemeral: true }).catch(() => {});
  }
});

process.on('unhandledRejection', (e) => console.error('unhandled rejection:', (e as Error)?.message ?? e));
await client.login(env.discordToken);
