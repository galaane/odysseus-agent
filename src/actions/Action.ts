import { z } from 'zod';

export const BaseActionSchema = z.object({
  id: z.string().default(() => `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
  targetTabId: z.string().optional(),
});

export const NavigateActionSchema = BaseActionSchema.extend({
  type: z.literal('navigate'),
  url: z.string().url(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load'),
  timeoutMs: z.number().int().positive().optional(),
});

export const ClickActionSchema = BaseActionSchema.extend({
  type: z.literal('click'),
  targetId: z.string(), // Stable element ID (e.g. "el_012") or selector
  timeoutMs: z.number().int().positive().optional(),
});

export const FillActionSchema = BaseActionSchema.extend({
  type: z.literal('fill'),
  targetId: z.string(),
  value: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});

export const TypeActionSchema = BaseActionSchema.extend({
  type: z.literal('type'),
  targetId: z.string(),
  text: z.string(),
  delayMs: z.number().int().nonnegative().default(30),
  timeoutMs: z.number().int().positive().optional(),
});

export const PressActionSchema = BaseActionSchema.extend({
  type: z.literal('press'),
  targetId: z.string().optional(),
  key: z.string(), // e.g. "Enter", "Tab", "Escape"
});

export const ScrollActionSchema = BaseActionSchema.extend({
  type: z.literal('scroll'),
  direction: z.enum(['up', 'down']),
  amount: z.number().int().positive().default(500),
});

export const WaitActionSchema = BaseActionSchema.extend({
  type: z.literal('wait'),
  condition: z.enum(['network-idle', 'navigation', 'timeout', 'selector']),
  selector: z.string().optional(),
  timeoutMs: z.number().int().positive().default(5000),
});

export const ScreenshotActionSchema = BaseActionSchema.extend({
  type: z.literal('screenshot'),
  fullPage: z.boolean().default(false),
});

export const NewTabActionSchema = BaseActionSchema.extend({
  type: z.literal('new_tab'),
  url: z.string().url().optional(),
});

export const SwitchTabActionSchema = BaseActionSchema.extend({
  type: z.literal('switch_tab'),
  tabId: z.string(),
});

export const CloseTabActionSchema = BaseActionSchema.extend({
  type: z.literal('close_tab'),
  tabId: z.string(),
});

export const ExtractActionSchema = BaseActionSchema.extend({
  type: z.literal('extract'),
  targetId: z.string().optional(),
  instruction: z.string().default('Extract text content'),
});

export const BranchTabActionSchema = BaseActionSchema.extend({
  type: z.literal('branch_tab'),
  url: z.string().url().optional(),
  targetId: z.string().optional(),
  branchGoal: z.string().default('Speculative branch exploration'),
});

export const PruneBranchActionSchema = BaseActionSchema.extend({
  type: z.literal('prune_branch'),
  tabId: z.string().optional(),
  branchId: z.string().optional(),
  reason: z.string().default('Pruned dead-end or suboptimal path'),
});

export const PromoteBranchActionSchema = BaseActionSchema.extend({
  type: z.literal('promote_branch'),
  tabId: z.string().optional(),
  branchId: z.string().optional(),
});

export const HarvestNetworkPayloadActionSchema = BaseActionSchema.extend({
  type: z.literal('harvest_network_payload'),
  urlPattern: z.string(),
  jsonPath: z.string().optional(),
  destination: z.enum(['research', 'working', 'both']).default('both'),
  topic: z.string().optional(),
  maxItems: z.number().int().positive().default(20),
});

export const BrowserActionSchema = z.discriminatedUnion('type', [
  NavigateActionSchema,
  ClickActionSchema,
  FillActionSchema,
  TypeActionSchema,
  PressActionSchema,
  ScrollActionSchema,
  WaitActionSchema,
  ScreenshotActionSchema,
  NewTabActionSchema,
  SwitchTabActionSchema,
  CloseTabActionSchema,
  ExtractActionSchema,
  BranchTabActionSchema,
  PruneBranchActionSchema,
  PromoteBranchActionSchema,
  HarvestNetworkPayloadActionSchema,
]);

export type BaseAction = z.infer<typeof BaseActionSchema>;
export type NavigateAction = z.infer<typeof NavigateActionSchema>;
export type ClickAction = z.infer<typeof ClickActionSchema>;
export type FillAction = z.infer<typeof FillActionSchema>;
export type TypeAction = z.infer<typeof TypeActionSchema>;
export type PressAction = z.infer<typeof PressActionSchema>;
export type ScrollAction = z.infer<typeof ScrollActionSchema>;
export type WaitAction = z.infer<typeof WaitActionSchema>;
export type ScreenshotAction = z.infer<typeof ScreenshotActionSchema>;
export type NewTabAction = z.infer<typeof NewTabActionSchema>;
export type SwitchTabAction = z.infer<typeof SwitchTabActionSchema>;
export type CloseTabAction = z.infer<typeof CloseTabActionSchema>;
export type ExtractAction = z.infer<typeof ExtractActionSchema>;
export type BranchTabAction = z.infer<typeof BranchTabActionSchema>;
export type PruneBranchAction = z.infer<typeof PruneBranchActionSchema>;
export type PromoteBranchAction = z.infer<typeof PromoteBranchActionSchema>;
export type HarvestNetworkPayloadAction = z.infer<typeof HarvestNetworkPayloadActionSchema>;

export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type ActionType = BrowserAction['type'];
