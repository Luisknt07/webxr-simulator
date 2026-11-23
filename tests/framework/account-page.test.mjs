import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{accountPage}=require('../../apps/api/account-page.cjs');

test('account page offers login and registration with browser password confirmation and a policy-aware invitation',()=>{
 const html=accountPage({nonce:'synthetic-nonce',destination:'/play?scene=vr-warehouse-missions'});
 assert.match(html,/id="login"/);assert.match(html,/id="register" hidden/);assert.match(html,/id="register-mode"/);assert.match(html,/name="confirmPassword"/);assert.match(html,/minlength="12"/);assert.match(html,/autocomplete="new-password"/);assert.match(html,/registration\.invitationRequired/);
 const script=html.match(/<script nonce="synthetic-nonce">([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new Function(script));assert(script.includes('location.assign(destination)'));assert(script.includes("'/api/studio/'"));assert(!html.includes('localStorage'));
});

test('the redirect is a JSON literal and cannot close the nonce-protected script element',()=>{
 const html=accountPage({nonce:'synthetic-nonce',destination:'/play?value=</script><script>alert(1)</script>'});
 assert.equal((html.match(/<script\b/g)||[]).length,1);assert(html.includes('\\u003c/script>'));assert(!html.includes('value=</script>'));
});
