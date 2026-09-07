import { describe, it, expect } from 'vitest';
import { Planner } from '../../src/agent/Planner.js';

describe('Planner Subsystem', () => {
  const planner = new Planner();

  it('should formulate an initial plan tailored to search/research goals', () => {
    const plan = planner.createInitialPlan('Find the official pricing for Product X');

    expect(plan.milestones.length).toBeGreaterThanOrEqual(3);
    expect(plan.currentMilestoneIndex).toBe(0);
    expect(plan.milestones[0].status).toBe('in_progress');
    expect(plan.milestones[0].description).toContain('Navigate to target');
    expect(plan.milestones[1].description).toContain('Locate relevant content');
  });

  it('should formulate an initial plan tailored to authentication goals', () => {
    const plan = planner.createInitialPlan('Sign in to the customer portal');

    expect(plan.milestones[1].description).toContain('authentication form fields');
  });

  it('should advance milestones on success', () => {
    const plan = planner.createInitialPlan('Research company info');

    expect(plan.currentMilestoneIndex).toBe(0);
    expect(plan.milestones[0].status).toBe('in_progress');

    planner.advanceMilestone(plan, true);

    expect(plan.milestones[0].status).toBe('completed');
    expect(plan.currentMilestoneIndex).toBe(1);
    expect(plan.milestones[1].status).toBe('in_progress');
  });

  it('should dynamically replan and insert adaptation milestone upon divergence', () => {
    const plan = planner.createInitialPlan('Navigate and extract details');
    const initialMilestoneCount = plan.milestones.length;

    planner.replan(plan, 'Login button was disabled due to captcha');

    expect(plan.milestones.length).toBe(initialMilestoneCount + 1);
    const activeMilestone = planner.getCurrentMilestone(plan);
    expect(activeMilestone?.description).toContain('Adapt strategy: Login button was disabled due to captcha');
    expect(activeMilestone?.status).toBe('in_progress');
  });

  it('should format clean plan summary for prompt context', () => {
    const plan = planner.createInitialPlan('Test Task');
    const summary = planner.formatPlanSummary(plan);

    expect(summary).toContain('1. [in_progress]');
    expect(summary).toContain('[ACTIVE]');
    expect(summary).toContain('2. [pending]');
  });
});
