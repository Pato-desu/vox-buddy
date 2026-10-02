import { SlashCommandBuilder } from 'discord.js';

export const commandDefs = [
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel and start listening'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
].map((c) => c.toJSON());

export type CommandName = 'join' | 'leave';
