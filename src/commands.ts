import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commandDefs = [
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel and start listening'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
  new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Reload how the bot talks from persona.md')
    .addSubcommand((s) => s.setName('reload').setDescription('Re-read persona.md')),
  new SlashCommandBuilder()
    .setName('hush')
    .setDescription('Stop answering (keeps listening). `/hush off` resumes')
    .addStringOption((o) => o.setName('state').setDescription('on, off, or leave empty to toggle').addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),
  new SlashCommandBuilder().setName('status').setDescription('Show channel, voice, speech sidecar health and latency'),
  new SlashCommandBuilder()
    .setName('mode')
    .setDescription('classic = local speech + Gemini text; live = Gemini Live in the cloud hears and speaks')
    .addStringOption((o) =>
      o.setName('which').setDescription('live sends call audio to Google; classic keeps audio on this PC').setRequired(true).addChoices({ name: 'classic', value: 'classic' }, { name: 'live', value: 'live' }),
    ),
  new SlashCommandBuilder().setName('usage').setDescription('Show Gemini requests used today out of the daily limit'),
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) => s.setName('on').setDescription('Mirror into this channel'))
    .addSubcommand((s) => s.setName('off').setDescription('Stop mirroring')),
  new SlashCommandBuilder()
    .setName('autojoin')
    .setDescription('Join a voice channel automatically when the bot starts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) => s.setName('here').setDescription('Use the voice channel you are in'))
    .addSubcommand((s) => s.setName('off').setDescription('Do not auto-join')),
].map((c) => c.toJSON());

export type CommandName = 'join' | 'leave' | 'persona' | 'hush' | 'status' | 'usage' | 'mode' | 'voice' | 'voices' | 'mirror' | 'autojoin';
