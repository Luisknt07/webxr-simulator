 /*

	This is modification of the original VRButton. I've added a callback to know
	when the user enters and exists from VR

	Original at:
	  https://github.com/mrdoob/three.js/blob/dev/examples/jsm/webxr/VRButton.js

 */
/**
 * @author mrdoob / http://mrdoob.com
 * @author Mugen87 / https://github.com/Mugen87
 */

var VRButton = {

	createButton: function ( renderer, callback, canStart, options ) {

		options = options || {};

		function showEnterVR( /*device*/ ) {

			var currentSession = null;
			var pending = false;
			var notified = false;

			function setPending( value ) {
				pending = value;
				button.disabled = value;
				button.setAttribute( 'aria-busy', value ? 'true' : 'false' );
			}

			function assignRendererSession( session ) {
				var xr = renderer.xr;
				// r112 returns undefined from setSession and reports readiness later.
				// Newer managers may return a Promise; adapters without events retain
				// that contract. Register before assignment to catch synchronous starts.
				if ( !xr.addEventListener || !xr.removeEventListener || typeof xr.isPresenting !== 'boolean' ) {
					return Promise.resolve( xr.setSession( session ) );
				}
				return new Promise( function ( resolve, reject ) {
					var settled = false;
					var timeout = Number( options.sessionStartTimeoutMs );
					if ( !Number.isFinite( timeout ) || timeout <= 0 ) timeout = 10000;
					timeout = Math.min( timeout, 30000 );
					var timer;
					function finish( error ) {
						if ( settled ) return;
						settled = true;
						clearTimeout( timer );
						xr.removeEventListener( 'sessionstart', started );
						session.removeEventListener( 'end', ended );
						error ? reject( error ) : resolve();
					}
					function started() {
						if ( xr.getSession && xr.getSession() !== session ) return;
						finish();
					}
					function ended() {
						var error = new Error( 'La sesión VR terminó antes de estar lista.' );
						error.cancelled = true;
						finish( error );
					}
					xr.addEventListener( 'sessionstart', started );
					session.addEventListener( 'end', ended );
					timer = setTimeout( function () { finish( new Error( 'El visor no confirmó la entrada en VR.' ) ); }, timeout );
					try {
						var assigned = xr.setSession( session );
						if ( assigned && typeof assigned.then === 'function' ) assigned.then( function () {
							if ( xr.isPresenting ) started();
						}, finish );
						if ( xr.isPresenting ) started();
					} catch ( error ) { finish( error ); }
				} );
			}

			function requestPreferredFrameRate( session ) {
				// A device-specific option is a request, not an achieved-FPS claim.
				// Keep entry responsive and retain the runtime's rate if unsupported.
				var rate = options.preferredFrameRate;
				if ( currentSession !== session || !Number.isFinite( rate ) || rate < 30 ) return;
				try {
					if ( typeof session.updateTargetFrameRate !== 'function' || !session.supportedFrameRates ||
						Array.from( session.supportedFrameRates ).indexOf( rate ) === -1 || session.frameRate === rate ) return;
					var update = session.updateTargetFrameRate( rate );
					if ( update && typeof update.catch === 'function' ) update.catch( function () {} );
				} catch ( error ) { /* The browser retains its current supported rate. */ }
			}

			async function onSessionStarted( session ) {

				session.addEventListener( 'end', onSessionEnded );
				currentSession = session;
				var referenceSpaceType = 'local-floor';

				try {
					// Three r112 requests local-floor without a rejection fallback.
					// Negotiate it before handing over the session; local remains
					// usable on devices that do not expose a floor reference space.
					if ( renderer.xr.setReferenceSpaceType && session.requestReferenceSpace ) {
						try { await session.requestReferenceSpace( referenceSpaceType ); }
						catch ( error ) { referenceSpaceType = 'local'; await session.requestReferenceSpace( referenceSpaceType ); }
						if ( currentSession !== session ) return;
						renderer.xr.setReferenceSpaceType( referenceSpaceType );
					}
					await assignRendererSession( session );
				} catch ( error ) {
					session.removeEventListener( 'end', onSessionEnded );
					var needsEnd = currentSession === session;
					if ( needsEnd ) currentSession = null;
					if ( needsEnd ) try { await session.end(); } catch ( endError ) { /* The session may already have ended. */ }
					throw error;
				}
				if ( currentSession !== session ) return;

				button.textContent = 'Salir de VR';
				button.title = '';
				setPending( false );
				notified = true;
				callback('sessionStarted', {referenceSpaceType: referenceSpaceType});
				requestPreferredFrameRate( session );
			}

			function onSessionEnded( /*event*/ ) {

				if ( !currentSession ) return;
				currentSession.removeEventListener( 'end', onSessionEnded );

				button.textContent = 'Entrar en VR';

				currentSession = null;
				setPending( false );
				if ( notified ) {
					notified = false;
					callback('sessionEnded');
				}
			}


			//

			button.style.display = '';

			button.style.cursor = 'pointer';
			button.style.left = 'calc(50% - 50px)';
			button.style.width = '100px';

			button.textContent = 'Entrar en VR';
			button.removeAttribute('aria-disabled');

			button.onmouseenter = function () {

				button.style.opacity = '1.0';

			};

			button.onmouseleave = function () {

				button.style.opacity = '0.5';

			};

			button.onclick = async function () {
				if ( pending ) return;

				if ( currentSession === null ) {
					var allowed = canStart ? canStart() : true;
					if ( allowed !== true && allowed !== undefined ) {
						button.title = typeof allowed === 'string' ? allowed : 'Espera a que termine la operación actual antes de entrar en VR.';
						return;
					}
					setPending( true );

					// WebXR's requestReferenceSpace only works if the corresponding feature
					// was requested at session creation time. For simplicity, just ask for
					// the interesting ones as optional features, but be aware that the
					// requestReferenceSpace call will fail if it turns out to be unavailable.
					// ('local' is always available for immersive sessions and doesn't need to
					// be requested separately.)

					var sessionInit = { optionalFeatures: [ 'local-floor', 'bounded-floor' ] };
					try {
						var session = await navigator.xr.requestSession( 'immersive-vr', sessionInit );
						await onSessionStarted( session );
					} catch ( error ) {
						setPending( false );
						button.textContent = error && error.cancelled ? 'Entrar en VR' : 'Reintentar VR';
						button.title = error && error.cancelled ? '' : 'No se pudo iniciar la sesión inmersiva. Revisa el permiso del visor.';
					}

				} else {

					setPending( true );
					try { await currentSession.end(); } catch ( error ) {
						setPending( false );
						button.title = 'No se pudo salir de VR. Vuelve a intentarlo desde el visor o este botón.';
					}

				}

			};

		}

		function disableButton() {

			button.style.display = '';

			button.style.cursor = 'auto';
			button.style.left = 'calc(50% - 75px)';
			button.style.width = '150px';

			button.onmouseenter = null;
			button.onmouseleave = null;

			button.onclick = null;

		}

		function showWebXRNotFound() {

			disableButton();

			button.textContent = 'VR no disponible';
			button.setAttribute('aria-disabled', 'true');
			button.title = 'Puedes explorar con teclado y ratón.';

		}

		function stylizeElement( element ) {

			element.style.position = 'absolute';
			element.style.bottom = '20px';
			element.style.padding = '12px 6px';
			element.style.border = '1px solid #fff';
			element.style.borderRadius = '4px';
			element.style.background = 'rgba(0,0,0,0.1)';
			element.style.color = '#fff';
			element.style.font = 'normal 13px sans-serif';
			element.style.textAlign = 'center';
			element.style.opacity = '0.5';
			element.style.outline = 'none';
			element.style.zIndex = '999';

		}

		// A polyfill may still expose navigator.xr on HTTP. Immersive entry needs
		// a secure origin regardless of that property, including Quest Browser.
		if ( 'xr' in navigator && window.isSecureContext !== false ) {

			var button = document.createElement( 'button' );
			button.style.display = 'none';

			stylizeElement( button );

			navigator.xr.isSessionSupported( 'immersive-vr' ).then( function ( supported ) {

				supported ? showEnterVR() : showWebXRNotFound();

			} ).catch(showWebXRNotFound);

			return button;

		} else {

			var message = document.createElement( 'a' );

			if ( window.isSecureContext === false ) {

				message.href = document.location.href.replace( /^http:/, 'https:' );
				message.textContent = 'VR requiere HTTPS';

			} else {

				message.removeAttribute('href');
				message.textContent = 'VR no disponible';
				message.setAttribute('aria-disabled', 'true');

			}

			message.style.left = 'calc(50% - 90px)';
			message.style.width = '180px';
			message.style.textDecoration = 'none';

			stylizeElement( message );

			return message;

		}

	}

};

export { VRButton };
