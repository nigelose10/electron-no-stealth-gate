// Fixture: eClass write and auto-login calls in shipped source.
call('mod_quiz_start_attempt');
call('mod_quiz_save_attempt');
call('mod_quiz_process_attempt');
call('mod_assign_submit_for_grading');
call('core_message_send_instant_messages');
call('mod_forum_add_discussion_post');
call('tool_mobile_get_autologin_key');
fetch('https://app.crowdmark.com/api/v1/assessments');
