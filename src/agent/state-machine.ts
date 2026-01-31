import OpenAI from 'openai';
import { config } from '../config';
import { buildSystemPrompt, LeadData } from './prompts';
import { logger } from '../utils/logger';

export type AgentState = 'greeting' | 'qualifying' | 'transferring' | 'ended';
export type AgentAction = 'speak' | 'transfer_allstate' | 'transfer_other' | 'transfer' | 'end';

export interface AgentTurn {
  action: AgentAction;
  text: string;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class AgentStateMachine {
  private state: AgentState = 'greeting';
  private messages: Message[] = [];
  private openai: OpenAI;
  private lead: LeadData;
  private turnCount = 0;

  constructor(lead: LeadData) {
    this.lead = lead;
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
    this.messages.push({
      role: 'system',
      content: buildSystemPrompt(lead),
    });
  }

  getState(): AgentState {
    return this.state;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  async processUserInput(transcript: string): Promise<AgentTurn> {
    this.turnCount++;
    logger.info('agent', `Turn ${this.turnCount}`, { state: this.state, userSaid: transcript });

    this.messages.push({ role: 'user', content: transcript });

    const response = await this.openai.chat.completions.create({
      model: config.openai.model,
      messages: this.messages,
      max_tokens: 200,
      temperature: 0.7,
    });

    const raw = response.choices[0]?.message?.content || '';
    this.messages.push({ role: 'assistant', content: raw });

    return this.parseResponse(raw);
  }

  private parseResponse(raw: string): AgentTurn {
    const trimmed = raw.trim();

    if (trimmed.includes('[TRANSFER_ALLSTATE]')) {
      this.state = 'transferring';
      const text = trimmed.replace('[TRANSFER_ALLSTATE]', '').trim();
      logger.info('agent', 'Transfer ALLSTATE triggered', { text });
      return { action: 'transfer_allstate', text };
    }

    if (trimmed.includes('[TRANSFER_OTHER]')) {
      this.state = 'transferring';
      const text = trimmed.replace('[TRANSFER_OTHER]', '').trim();
      logger.info('agent', 'Transfer OTHER triggered', { text });
      return { action: 'transfer_other', text };
    }

    // Legacy support
    if (trimmed.includes('[TRANSFER_NOW]')) {
      this.state = 'transferring';
      const text = trimmed.replace('[TRANSFER_NOW]', '').trim();
      logger.info('agent', 'Transfer (legacy) triggered', { text });
      return { action: 'transfer', text };
    }

    if (trimmed.includes('[CALL_END]')) {
      this.state = 'ended';
      const text = trimmed.replace('[CALL_END]', '').trim();
      logger.info('agent', 'Call end triggered', { text });
      return { action: 'end', text };
    }

    if (this.state === 'greeting' && this.turnCount >= 1) {
      this.state = 'qualifying';
    }

    return { action: 'speak', text: trimmed };
  }
}
