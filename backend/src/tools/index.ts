import { toolRegistry } from '../services/toolRegistry';
import { calculator } from './calculator';
import { webSearch } from './webSearch';
import { fetchUrl } from './fetchUrl';
import { googleCalendar } from './googleCalendar';
import { getCurrentDate } from './getCurrentDate';
import { readEmails } from './readEmails';
import { searchEmails } from './searchEmails';
import { summarizeEmails } from './summarizeEmails';
import { draftEmail } from './draftEmail';
import { replyEmail } from './replyEmail';

export function registerAllTools(): void {
  toolRegistry.register(calculator);
  toolRegistry.register(webSearch);
  toolRegistry.register(fetchUrl);
  toolRegistry.register(googleCalendar);
  toolRegistry.register(getCurrentDate);
  toolRegistry.register(readEmails);
  toolRegistry.register(searchEmails);
  toolRegistry.register(summarizeEmails);
  toolRegistry.register(draftEmail);
  toolRegistry.register(replyEmail);
}
