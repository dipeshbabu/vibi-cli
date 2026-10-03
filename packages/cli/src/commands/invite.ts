import { emailSchema } from '@vibivibi/shared/sessions';
import { ApiError } from '../api';
import { requireConfig } from '../config';
import { fail } from '../log';
import { describeInvite, inviteRecipient } from '../push';

/** `vibi invite <email>`: mail someone a sign-up link so you can send them sessions later. */
export async function invite(email: string) {
  const config = requireConfig();
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) fail('provide a valid email address.');
  try {
    console.log(describeInvite(await inviteRecipient(config, parsed.data)));
  } catch (error) {
    if (error instanceof ApiError) fail(error.message, error.status === 401 ? 2 : 1);
    throw error;
  }
}
