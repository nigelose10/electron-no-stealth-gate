// Fixture: tests may name banned eClass functions and copy to prove they are rejected.
for (const fn of ['mod_quiz_start_attempt', 'mod_assign_submit_for_grading', 'tool_mobile_get_autologin_key']) {
  expect(() => call(fn)).toThrow();
}
expect(copy).not.toMatch(/undetectable|invisible to/i);
