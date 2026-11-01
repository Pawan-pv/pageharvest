/**
 * Import path used across the application for the runtime protocol.
 * The protocol itself is defined once, in src/shared/contracts/message.ts.
 */
import { BrowserMessage, BrowserMessageSchema } from '../shared/contracts/message';

export * from '../shared/contracts/message';

export const extensionMessageSchema = BrowserMessageSchema;
export type ExtensionMessage = BrowserMessage;
