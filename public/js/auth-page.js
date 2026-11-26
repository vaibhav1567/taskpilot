let signup = false;
const $ = id => document.getElementById(id);
const render = () => {
  $('heading').textContent = signup ? 'Create your account' : 'Welcome back';
  $('subtitle').textContent = signup ? 'Get started with your AI workspace.' : 'Sign in to continue to your missions.';
  $('submitBtn').textContent = signup ? 'Create account' : 'Sign in';
  $('switchText').textContent = signup ? 'Already have an account?' : 'New to TaskPilot?';
  $('switchBtn').textContent = signup ? 'Sign in' : 'Create account';
  $('passwordHint').hidden = !signup;
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('password').minLength = signup ? 12 : 1;
  $('error').textContent = '';
};
$('switchBtn').onclick = () => { signup = !signup; render(); };
$('togglePassword').onclick = () => {
  const input = $('password'); input.type = input.type === 'password' ? 'text' : 'password';
  $('togglePassword').textContent = input.type === 'password' ? 'Show' : 'Hide';
};
$('authForm').onsubmit = async e => {
  e.preventDefault(); $('error').textContent = ''; $('submitBtn').disabled = true;
  try {
    const response = await fetch('/api/auth/' + (signup ? 'signup' : 'login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('email').value, password: $('password').value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Authentication failed.');
    location.replace('/');
  } catch (err) { $('error').textContent = err.message; }
  finally { $('submitBtn').disabled = false; }
};
fetch('/api/auth/me').then(r => { if (r.ok) location.replace('/'); }).catch(() => {});
render();
