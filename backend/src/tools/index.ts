import { toolRegistry } from '../services/toolRegistry';
import * as calculator from './calculator';
import * as webSearch from './webSearch';
import * as fetchUrl from './fetchUrl';

export function registerAllTools(): void {
  toolRegistry.register(calculator.definition, calculator.handler);
  toolRegistry.register(webSearch.definition, webSearch.handler);
  toolRegistry.register(fetchUrl.definition, fetchUrl.handler);
}
