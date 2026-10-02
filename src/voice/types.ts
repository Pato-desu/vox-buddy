import type { DiscordGatewayAdapterCreator } from '@discordjs/voice';

/** Supplies the gateway adapter the voice library needs for a guild (discord.js `guild.voiceAdapterCreator`). */
export interface DiscordGateway {
  adapterFor(guildId: string): DiscordGatewayAdapterCreator;
}
