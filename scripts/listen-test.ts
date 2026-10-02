// `npm run listen-test`: joins your voice channel and prints "heard N seconds from <user>". Receive-only: proves DAVE works.
// Usage: join a voice channel on your server, then run this. It joins the first channel you are in.
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnv, tuning } from '../src/config.js';
import { ManagedConnection, createDiscordJoiner } from '../src/voice/connection.js';
import { adaptReceiver, attachReceive } from '../src/voice/receive.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* use the real environment */
}
const env = loadEnv();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(env.guildId);
  await guild.members.fetch();
  const occupied = guild.channels.cache.find((c) => c.isVoiceBased() && c.members.some((m) => !m.user.bot));
  if (!occupied?.isVoiceBased()) {
    console.error('Nobody is in a voice channel. Join one and run again.');
    process.exit(1);
  }
  const managed = new ManagedConnection(
    { guildId: guild.id, channelId: occupied.id },
    { join: createDiscordJoiner({ adapterFor: () => guild.voiceAdapterCreator }), log: console.log },
  );
  const conn = managed.start();
  console.log(`joined "${occupied.name}" with DAVE on. Say something...`);
  attachReceive(adaptReceiver((conn as unknown as { receiver: Parameters<typeof adaptReceiver>[0] }).receiver), {
    capture: tuning,
    resolveSpeaker: (id) => {
      const m = guild.members.cache.get(id);
      return m ? { userId: id, userName: m.displayName, isBot: m.user.bot } : undefined;
    },
    onUtterance: (u) => console.log(`heard ${(u.pcm.length / 16000).toFixed(1)} seconds from ${u.userName}`),
    onError: (e) => console.error('stream error:', e.message),
  });
});
await client.login(env.discordToken);
