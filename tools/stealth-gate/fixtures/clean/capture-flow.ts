// Fixture: legitimate code that sits next to the banned patterns.
const CAPTURE = /^(moodlemobile|geekapp):\/\/token=(.+)$/;
ses.protocol.handle('moodlemobile', handler);
ses.protocol.handle('geekapp', handler);
app.setAsDefaultProtocolClient('geek');
const guarded = ['mod/quiz/startattempt.php', 'mod/quiz/attempt.php', 'mod/quiz/processattempt.php'];
const ua = `${session.getUserAgent()} Geek/0.1.0`;
if (win.isContentProtected()) throw new Error('capture must stay visible');
app.dock?.show();
app.setActivationPolicy('regular');
const allowed = ['mod_quiz_get_quizzes_by_courses', 'mod_quiz_get_user_attempts'];
