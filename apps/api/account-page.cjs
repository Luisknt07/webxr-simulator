'use strict';

function accountPage({nonce, destination}) {
 const next=JSON.stringify(destination).replace(/</g,'\\u003c');
 return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceder a SmartTwin</title><link rel="icon" href="data:,">
<style nonce="${nonce}">
*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;background:#10212b;color:#e7f4f4;margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px}main{width:min(100%,440px);padding:28px;border:1px solid #36545e;border-radius:18px;background:#162c36;box-shadow:0 20px 70px #0003}h1{font-size:26px;line-height:1.25;margin:4px 0 8px}h2{font-size:21px;margin:24px 0 8px}p{margin:8px 0 18px}.brand{color:#a8e4d3;font-size:12px;letter-spacing:.12em;font-weight:700}.muted,small{color:#b2cbd0}.modes{display:flex;gap:8px;margin:22px 0 8px}.modes button{flex:1;background:transparent;color:#d7e8eb;border-color:#52707a}.modes button[aria-pressed=true]{background:#83dfc3;color:#102b2e;border-color:#83dfc3}label{display:block;margin-top:14px;font-weight:600;font-size:14px}input,button{font:inherit;width:100%;padding:11px 12px;border-radius:8px;border:1px solid #64838d}input{display:block;margin-top:5px;background:#0c202a;color:#f3fbfc;min-height:46px}button{background:#83dfc3;color:#102b2e;font-weight:650;cursor:pointer;min-height:46px}button[type=submit]{margin-top:22px}button:disabled{opacity:.55;cursor:wait}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #9cf4dd;outline-offset:3px}small{display:block;font-size:12px;margin-top:5px;font-weight:400}a{color:#a0eed8}.footer{display:block;text-align:center;margin-top:24px;font-size:14px}#message{margin:16px 0 0;min-height:24px;overflow-wrap:anywhere;color:#ffd8a1}#registration-status{font-size:14px;line-height:1.5;margin:8px 0 14px}.retry{width:auto;background:transparent;color:#a0eed8;margin:8px 0;padding:7px 12px}[hidden]{display:none!important}@media(max-width:450px){body{padding:12px}main{padding:22px 18px;border-radius:12px}.modes button{padding:10px 7px;font-size:14px}}
</style></head><body><main>
<div class="brand">SMART-TWIN</div><h1>Tu espacio de trabajo</h1><p class="muted">Accede a tus escenarios y proyectos.</p>
<nav class="modes" aria-label="Acceso a la cuenta"><button id="login-mode" type="button" aria-pressed="true" aria-controls="login-section">Iniciar sesión</button><button id="register-mode" type="button" aria-pressed="false" aria-controls="register-section">Crear cuenta</button></nav>
<section id="login-section" aria-labelledby="login-title"><h2 id="login-title">Iniciar sesión</h2><form id="login">
<label>Usuario<input name="username" autocomplete="username" required maxlength="48" autocapitalize="none" spellcheck="false"></label>
<label>Contraseña<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
<button type="submit">Iniciar sesión</button></form></section>
<section id="register-section" aria-labelledby="register-title" hidden><h2 id="register-title">Crear una cuenta</h2><p id="registration-status" class="muted" role="status">Comprobando disponibilidad del registro…</p><button id="registration-retry" class="retry" type="button" hidden>Reintentar</button>
<form id="register" hidden>
<label>Nombre visible <span class="muted">(opcional)</span><input name="displayName" autocomplete="nickname" maxlength="80"></label>
<label>Usuario<input name="username" autocomplete="username" required minlength="3" maxlength="48" autocapitalize="none" spellcheck="false" aria-describedby="username-help"><small id="username-help">De 3 a 48 caracteres: letras, números, punto, guion o guion bajo.</small></label>
<label>Contraseña<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="256" aria-describedby="password-help"><small id="password-help">Usa entre 12 y 256 caracteres.</small></label>
<label>Confirmar contraseña<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="256"></label>
<label><span id="code-label">Código de registro (opcional)</span><input name="code" autocomplete="off" maxlength="80" autocapitalize="characters" spellcheck="false" aria-describedby="code-help"><small id="code-help">Si recibiste una invitación, escribe su código.</small></label>
<button type="submit">Crear cuenta y entrar</button></form></section>
<p id="message" role="alert" aria-live="polite"></p><a class="footer" href="/">Volver al escenario público</a>
</main><script nonce="${nonce}">
(() => {
 const destination=${next},byId=id=>document.getElementById(id),login=byId('login'),register=byId('register'),message=byId('message');
 let mode='login',busy=false,registration=null;
 const setMode=value=>{if(busy)return;mode=value;byId('login-section').hidden=mode!=='login';byId('register-section').hidden=mode!=='register';byId('login-mode').setAttribute('aria-pressed',String(mode==='login'));byId('register-mode').setAttribute('aria-pressed',String(mode==='register'));message.textContent='';login.elements.password.value='';register.elements.password.value='';register.elements.confirmPassword.value='';register.elements.confirmPassword.setCustomValidity('');};
 byId('login-mode').addEventListener('click',()=>setMode('login'));byId('register-mode').addEventListener('click',()=>setMode('register'));
 async function loadRegistration(){
  registration=null;register.hidden=true;byId('registration-retry').hidden=true;byId('registration-status').textContent='Comprobando disponibilidad del registro…';
  try{const response=await fetch('/api/studio/me',{credentials:'same-origin',headers:{Accept:'application/json'}});if(!response.ok)throw Error();const value=await response.json();if(!value.registration||typeof value.registration.enabled!=='boolean'||typeof value.registration.invitationRequired!=='boolean')throw Error();registration=value.registration;
   register.hidden=!registration.enabled;register.elements.code.required=registration.invitationRequired;byId('code-label').textContent=registration.invitationRequired?'Código de registro':'Código de registro (opcional)';byId('code-help').textContent=registration.invitationRequired?'Solicita este código al administrador o a tu docente.':'Si recibiste una invitación, escribe su código.';
   byId('registration-status').textContent=!registration.enabled?'El registro aún no está disponible en este servidor. Solicita acceso al administrador.':registration.invitationRequired?'Puedes crear tu cuenta con un código de invitación.':'Crea tu cuenta para empezar. Al terminar entrarás automáticamente.';
  }catch(_){byId('registration-status').textContent='No pudimos comprobar si el registro está disponible. Puedes reintentar o iniciar sesión con una cuenta existente.';byId('registration-retry').hidden=false;}
 }
 byId('registration-retry').addEventListener('click',loadRegistration);
 const validateConfirmation=()=>register.elements.confirmPassword.setCustomValidity(register.elements.confirmPassword.value&&register.elements.password.value!==register.elements.confirmPassword.value?'Las contraseñas no coinciden.':'');
 register.elements.password.addEventListener('input',validateConfirmation);register.elements.confirmPassword.addEventListener('input',validateConfirmation);
 for(const form of [login,register])form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;const creating=form===register;if(creating&&(!registration||!registration.enabled))return;
  const username=form.elements.username.value.trim();if(creating&&!/^[a-z0-9][a-z0-9_.-]{2,47}$/i.test(username)){message.textContent='El usuario debe tener entre 3 y 48 caracteres y usar letras, números, punto, guion o guion bajo.';form.elements.username.focus();return;}
  if(creating){validateConfirmation();if(!form.reportValidity())return;}
  busy=true;message.textContent='';const submit=form.querySelector('button[type=submit]'),label=submit.textContent;submit.disabled=true;submit.textContent=creating?'Creando cuenta…':'Iniciando sesión…';byId('login-mode').disabled=byId('register-mode').disabled=true;
  try{const payload={username,password:form.elements.password.value};if(creating){payload.displayName=form.elements.displayName.value.trim()||username;const code=form.elements.code.value.trim();if(code)payload.code=code;}
   const response=await fetch('/api/studio/'+(creating?'register':'login'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});const value=await response.json();if(!response.ok){if(creating&&value.code==='registration_code_required'){registration.invitationRequired=true;register.elements.code.required=true;byId('code-label').textContent='Código de registro';}throw Error(value.error||(creating?'No se pudo crear la cuenta.':'No se pudo iniciar sesión.'));}
   form.elements.password.value='';if(creating){form.elements.confirmPassword.value='';form.elements.code.value='';}location.assign(destination);
  }catch(error){message.textContent=error.message||'No se pudo completar la solicitud. Inténtalo de nuevo.';}
  finally{busy=false;submit.disabled=false;submit.textContent=label;byId('login-mode').disabled=byId('register-mode').disabled=false;}
 });
 if(new URL(location.href).searchParams.get('mode')==='register')setMode('register');loadRegistration();
})();
</script></body></html>`;
}

module.exports={accountPage};
