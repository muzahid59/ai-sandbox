import { toolRegistry } from '../services/toolRegistry';
import * as calculator from './calculator';
import * as webSearch from './webSearch';
import * as fetchUrl from './fetchUrl';
import * as googleCalendar from './googleCalendar';

export function registerAllTools(): void {
  toolRegistry.register(calculator.definition, calculator.handler);
  toolRegistry.register(webSearch.definition, webSearch.handler);
  toolRegistry.register(fetchUrl.definition, fetchUrl.handler);
  toolRegistry.register(googleCalendar.definition, googleCalendar.handler);
}
