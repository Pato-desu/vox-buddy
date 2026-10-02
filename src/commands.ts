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
].map((c) => c.toJSON());

export type CommandName = 'join' | 'leave' | 'persona' | 'hush' | 'status' | 'voice';
