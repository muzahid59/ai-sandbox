import { toolRegistry } from '../services/toolRegistry';
import { calculator } from './calculator';
import { webSearch } from './webSearch';
import { fetchUrl } from './fetchUrl';
import { googleCalendar } from './googleCalendar';
import { getCurrentDate } from './getCurrentDate';

export function registerAllTools(): void {
  toolRegistry.register(calculator);
  toolRegistry.register(webSearch);
  toolRegistry.register(fetchUrl);
  toolRegistry.register(googleCalendar);
  toolRegistry.register(getCurrentDate);
}
