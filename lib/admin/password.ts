/**
 * Strong password generation for org / adviser-admin credentials.
 * Unambiguous charset (no 0/O, 1/l/I). Guarantees mixed case + digit + symbol.
 */
import { randomInt } from 'crypto';

const PASSWORD_LEN = 20;
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export function generateAdminPassword(len = PASSWORD_LEN): string {
  const pick = (set: string) => set[randomInt(set.length)]!;
  const chars: string[] = [
    pick(LOWER),
    pick(UPPER),
    pick(DIGITS),
    pick(SYMBOLS),
  ];
  while (chars.length < len) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
