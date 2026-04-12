import { toolRegistry } from '../services/toolRegistry';
import * as calculator from './calculator';

export function registerAllTools(): void {
  toolRegistry.register(calculator.definition, calculator.handler);
}
