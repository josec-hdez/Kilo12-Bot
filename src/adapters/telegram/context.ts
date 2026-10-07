import type { Context } from 'grammy';
import type { User } from '../../ports/repositories.js';

/** Contexto del bot: el middleware de permisos deja aquí al usuario autorizado. */
export interface AuthFlavor {
  kiloUser?: User;
}

export type BotContext = Context & AuthFlavor;
