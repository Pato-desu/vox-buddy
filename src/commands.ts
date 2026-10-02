import { SlashCommandBuilder } from 'discord.js';

export const commandDefs = [
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel and start listening'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
  new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Reload how the bot talks from persona.md')
    .addSubcommand((s) => s.setName('reload').setDescription('Re-read persona.md')),
  new SlashCommandBuilder().setName('hush').setDescription('Stop answering (keeps listening). Run again to resume'),
  new SlashCommandBuilder().setName('status').setDescription('Show channel, voice, speech sidecar health and latency'),
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Pick the bot voice')
    .addStringOption((o) =>
      o.setName('which').setDescription('fast = quick offline voice, clone = your cloned sample').setRequired(true).addChoices({ name: 'fast', value: 'fast' }, { name: 'clone', value: 'clone' }),
    ),
  new SlashCommandBuilder()
    .setName('voices')
    .setDescription('List cloneable voice samples from the voices/ folder, or pick one')
    .addSubcommand((s) => s.setName('list').setDescription('Show the samples'))
    .addSubcommand((s) => s.setName('use').setDescription('Use a sample for the clone voice').addStringOption((o) => o.setName('name').setDescription('Sample name (see /voices list)').setRequired(true))),
  new SlashCommandBuilder()
    .setName('mirror')
    .setDescription('Post what the bot hears and says to this text channel (off by default)')
    .addSubcommand((s) => s.setName('on').setDescription('Mirror into this channel'))
    .addSubcommand((s) => s.setName('off').setDescription('Stop mirroring')),
].map((c) => c.toJSON());

export type CommandName = 'join' | 'leave' | 'persona' | 'hush' | 'status' | 'voice' | 'voices' | 'mirror';
