import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteDatabase } from '../../src/persistence/Database.js';
import { DomainPlaybookRepository } from '../../src/persistence/DomainPlaybookRepository.js';

describe('DomainPlaybookRepository Subsystem', () => {
  let db: SqliteDatabase;
  let repo: DomainPlaybookRepository;

  beforeEach(() => {
    db = new SqliteDatabase({ path: ':memory:' });
    repo = new DomainPlaybookRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should save a new playbook and retrieve by domain', () => {
    repo.savePlaybook({
      id: 'pb_001',
      domain: 'shop.example.com',
      pattern_type: 'workflow',
      pattern_key: 'search_laptops',
      playbook_data: JSON.stringify({ action: 'click->search_btn; fill->query' }),
      last_applied_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const playbooks = repo.getPlaybooksByDomain('shop.example.com');
    expect(playbooks.length).toBe(1);
    expect(playbooks[0].domain).toBe('shop.example.com');
    expect(playbooks[0].pattern_key).toBe('search_laptops');
    expect(playbooks[0].success_count).toBe(1);
  });

  it('should increment success_count on repeated saves for same domain and pattern_key', () => {
    repo.savePlaybook({
      id: 'pb_101',
      domain: 'portal.example.com',
      pattern_type: 'auth',
      pattern_key: 'login_form',
      playbook_data: JSON.stringify({ hint: 'enter email first, then submit' }),
      last_applied_at: '2026-09-01T10:00:00.000Z',
      created_at: '2026-09-01T10:00:00.000Z',
    });

    // Save again with same domain and key
    repo.savePlaybook({
      id: 'pb_102',
      domain: 'portal.example.com',
      pattern_type: 'auth',
      pattern_key: 'login_form',
      playbook_data: JSON.stringify({ hint: 'updated hint' }),
      last_applied_at: '2026-09-02T10:00:00.000Z',
      created_at: '2026-09-02T10:00:00.000Z',
    });

    const playbooks = repo.getPlaybooksByDomain('portal.example.com');
    expect(playbooks.length).toBe(1);
    expect(playbooks[0].success_count).toBe(2);
    expect(playbooks[0].playbook_data).toContain('updated hint');
  });

  it('should list all playbooks ordered by success_count', () => {
    repo.savePlaybook({
      id: 'pb_201',
      domain: 'a.com',
      pattern_type: 'nav',
      pattern_key: 'k1',
      playbook_data: '{}',
      success_count: 1,
      last_applied_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    repo.savePlaybook({
      id: 'pb_202',
      domain: 'b.com',
      pattern_type: 'nav',
      pattern_key: 'k2',
      playbook_data: '{}',
      success_count: 5,
      last_applied_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const all = repo.getAllPlaybooks();
    expect(all.length).toBe(2);
    expect(all[0].domain).toBe('b.com'); // higher success_count first
  });

  it('should delete a playbook by ID', () => {
    repo.savePlaybook({
      id: 'pb_del',
      domain: 'c.com',
      pattern_type: 'nav',
      pattern_key: 'kd',
      playbook_data: '{}',
      last_applied_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    expect(repo.getPlaybooksByDomain('c.com').length).toBe(1);
    repo.deletePlaybook('pb_del');
    expect(repo.getPlaybooksByDomain('c.com').length).toBe(0);
  });
});
