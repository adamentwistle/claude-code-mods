// A `herdr pane list` reply recorded from a live herdr session, trimmed to
// eight panes and renamed. Same shape and field names as herdr prints.
export const SELF_PANE = 'w93:p1'

export const PANE_LIST = JSON.stringify({
  id: 'cli:pane:list',
  result: {
    panes: [
      { agent_status: 'unknown', cwd: '/Users/me/Projects/web', focused: false, foreground_cwd: '/Users/me/Projects/web', pane_id: 'w4:p2', revision: 1, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 79 }, tab_id: 'w4:t2', terminal_id: 'term_9', terminal_title: 'npm run dev', terminal_title_stripped: 'npm run dev', workspace_id: 'w4' },
      { agent_status: 'unknown', cwd: '/Users/me/Projects/qube', focused: false, foreground_cwd: '/Users/me/Projects/qube', pane_id: 'w4:p1', revision: 1, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 79 }, tab_id: 'w4:t1', terminal_id: 'term_1', terminal_title: 'me@Mac:~/Projects/qube', terminal_title_stripped: 'me@Mac:~/Projects/qube', workspace_id: 'w4' },
      { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 'aaaa-1' }, agent_status: 'done', cwd: '/Users/me/Projects/supporthub', focused: false, foreground_cwd: '/Users/me/Projects/supporthub', pane_id: 'wA:pJ', revision: 16, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 77 }, tab_id: 'wA:t7', terminal_id: 'term_2', terminal_title: '✳ Brief execution', terminal_title_stripped: 'Brief execution', title: 'Brief execution', workspace_id: 'wA' },
      { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 'aaaa-2' }, agent_status: 'idle', cwd: '/Users/me/Projects/qn/Q', focused: false, foreground_cwd: '/Users/me/Projects/qn/Q', pane_id: 'w7T:p1', revision: 3, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 77 }, tab_id: 'w7T:t1', terminal_id: 'term_3', terminal_title: '✳ orch-q', terminal_title_stripped: 'orch-q', title: 'orch-q', workspace_id: 'w7T' },
      { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: '3f0c2a77-aaaa-4bbb-8ccc-000000000003' }, agent_status: 'working', cwd: '/Users/me/Projects/qube', focused: false, foreground_cwd: '/Users/me/Projects/qube', pane_id: 'w7W:p1', revision: 9, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 77 }, tab_id: 'w7W:t1', terminal_id: 'term_4', terminal_title: '◐ orch-qube', terminal_title_stripped: 'orch-qube', title: 'orch-qube', workspace_id: 'w7W' },
      { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 'aaaa-4' }, agent_status: 'blocked', cwd: '/Users/me/Projects/benchmark', focused: false, foreground_cwd: '/Users/me/Projects/benchmark', pane_id: 'w7W:p5', revision: 4, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 77 }, tab_id: 'w7W:t2', terminal_id: 'term_5', terminal_title: '◐ orch-benchy', terminal_title_stripped: 'orch-benchy', title: 'orch-benchy', workspace_id: 'w7W' },
      { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 'aaaa-5' }, agent_status: 'idle', cwd: '/Users/me/Projects/benchmark', focused: false, foreground_cwd: '/Users/me/Projects/benchmark', pane_id: 'w7V:p1', revision: 2, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 77 }, tab_id: 'w7V:t1', terminal_id: 'term_6', terminal_title: 'claude', terminal_title_stripped: 'claude', workspace_id: 'w7V' },
      { agent: 'codex', agent_session: { agent: 'codex', kind: 'id', source: 'herdr:codex', value: 'bbbb-1' }, agent_status: 'working', cwd: '/Users/me/Projects/qnsupport', focused: false, foreground_cwd: '/Users/me/Projects/qnsupport', pane_id: 'w8G:p1', revision: 5, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 77 }, tab_id: 'w8G:t1', terminal_id: 'term_7', terminal_title: 'codex review', terminal_title_stripped: 'codex review', title: 'codex review', workspace_id: 'w8G' },
      { agent: 'claude', agent_session: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: 'self-session' }, agent_status: 'working', cwd: '/Users/me/Projects', focused: true, foreground_cwd: '/Users/me/Projects', pane_id: 'w93:p1', revision: 20, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 77 }, tab_id: 'w93:t1', terminal_id: 'term_8', terminal_title: '◐ Mods for Quicknode', terminal_title_stripped: 'Mods for Quicknode', title: 'Mods for Quicknode', workspace_id: 'w93' },
    ],
  },
})

// `herdr pane process-info --pane <id>` for an idle shell and for one running
// a dev server, in the shape herdr prints.
export const IDLE_SHELL = JSON.stringify({
  id: 'cli:pane:process_info',
  result: { process_info: { foreground_process_group_id: 38391, foreground_processes: [{ argv: ['-zsh'], argv0: 'zsh', cmdline: '-zsh', cwd: '/Users/me/Projects/qube', name: 'zsh', pid: 38391 }], pane_id: 'w4:p1', shell_pid: 38391 }, type: 'pane_process_info' },
})

export const BUSY_SHELL = JSON.stringify({
  id: 'cli:pane:process_info',
  result: { process_info: { foreground_process_group_id: 51200, foreground_processes: [{ argv: ['node', '/Users/me/Projects/web/node_modules/.bin/vite'], argv0: 'node', cmdline: 'node /Users/me/Projects/web/node_modules/.bin/vite', cwd: '/Users/me/Projects/web', name: 'node', pid: 51201 }, { argv: ['npm', 'run', 'dev'], argv0: 'npm', cmdline: 'npm run dev', cwd: '/Users/me/Projects/web', name: 'npm', pid: 51200 }], pane_id: 'w4:p2', shell_pid: 38390 }, type: 'pane_process_info' },
})
