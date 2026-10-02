import { SlashCommandBuilder } from 'discord.js';

export const commandDefs = [
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel and start listening'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
  new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Reload how the bot talks from persona.md')
    .addSubcommand((s) => s.setName('reload').setDescription('Re-read persona.md')),
].map((c) => c.toJSON());

export type CommandName = 'join' | 'leave' | 'persona';
