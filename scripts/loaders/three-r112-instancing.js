'use strict';

// Keep the pinned r112 API. These compatibility repairs apply only while
// bundling its unminified distribution; installed dependencies stay untouched.
// A changed upstream source fails closed instead of silently missing a patch.
// Mesh and InstancedMesh may share a material. Retain two program/uniform
// states on that material, instead of recompiling whenever draw order changes.
// Also distinguish each batch's vertex binding and release its matrix VBO.
function replaceOne(source, expression, replacement, label) {
  const matches = source.match(expression), count = matches ? matches.length : 0;
  if (count !== 1) throw new Error('Three r112 compatibility: ' + label + ' matched ' + count + ' times.');
  return source.replace(expression, replacement);
}

function transform(input) {
  let source = String(input);
  if (!/\bREVISION\s*=\s*['"]112['"]/.test(source)) throw new Error('Three r112 compatibility requires the pinned revision 112 distribution.');
  if (source.includes('__webxrInstancingVariants')) throw new Error('Three r112 compatibility was applied twice.');
  // WebGL may report null rather than an empty diagnostic string when context
  // loss lands during compilation, before the DOM loss event can pause work.
  // Preserve actual compiler messages while allowing that in-flight frame to
  // unwind; fresh renderer caches are created by the restore listener.
  for (const argument of ['program', 'shader', 'glVertexShader', 'glFragmentShader']) {
    const method = argument === 'program' ? 'getProgramInfoLog' : 'getShaderInfoLog';
    const expression = new RegExp('gl\\.' + method + '\\( ' + argument + ' \\)\\.trim\\(\\)', 'g');
    source = replaceOne(source, expression, '( gl.' + method + '( ' + argument + ' ) || \'\' ).trim()', 'context-loss ' + argument + ' diagnostics');
  }
  source = replaceOne(source, /(function initMaterial\( material, scene, object \) \{\s*var materialProperties = )properties\.get\( material \)(;)/g,
    '$1getMaterialVariantProperties( material, object )$2', 'init variant lookup');
  source = replaceOne(source, /(function setProgram\( camera, scene, material, object \) \{[\s\S]*?var materialProperties = )properties\.get\( material \)(;)/g,
    '$1getMaterialVariantProperties( material, object )$2', 'render variant lookup');
  source = replaceOne(source, /(\/\/ changed glsl or parameters\s*)releaseMaterialProgramReference\( material \);/g,
    '$1releaseMaterialProgramReference( material, materialProperties );', 'release only changed variant');
  const release = `function getMaterialVariantProperties( material, object ) {

    var root = properties.get( material );
    var variants = root.__webxrInstancingVariants || ( root.__webxrInstancingVariants = {} );
    var key = object.isInstancedMesh === true ? 'instanced' : 'ordinary';
    return variants[ key ] || ( variants[ key ] = {} );

  }

  function releaseMaterialProgramReference( material, variant ) {

    var root = properties.get( material );
    var variants = variant !== undefined ? [ variant ] : root.__webxrInstancingVariants ?
      Object.keys( root.__webxrInstancingVariants ).map( function ( key ) { return root.__webxrInstancingVariants[ key ]; } ) : [ root ];
    material.program = undefined;
    for ( var index = 0; index < variants.length; index ++ ) {
      var programInfo = variants[ index ].program;
      if ( programInfo !== undefined ) {
        programCache.releaseProgram( programInfo );
        variants[ index ].program = undefined;
      }
    }

  }`;
  source = replaceOne(source, /function releaseMaterialProgramReference\( material \) \{[\s\S]*?\n\s*\}\s*\n\s*\/\/ Buffer rendering/g,
    release + '\n\n\t// Buffer rendering', 'variant program ownership');
  source = replaceOne(source, /(var refreshProgram = false;\s*var refreshMaterial = false;\s*var refreshLights = false;)/g,
    '$1\n\n\t\tmaterial.program = materialProperties.program;', 'last active material program');
  source = replaceOne(source, /(_currentGeometryProgram\.wireframe !== \( material\.wireframe === true \) )(\) \{)/g,
    '$1|| _currentGeometryProgram.instanceMatrix !== object.instanceMatrix $2', 'instance matrix binding key');
  source = replaceOne(source, /(_currentGeometryProgram\.wireframe = material\.wireframe === true;)/g,
    '$1\n\t\t\t_currentGeometryProgram.instanceMatrix = object.instanceMatrix;', 'remember instance matrix binding');

  // r112 uploads instanceMatrix outside BufferGeometry.attributes, but never
  // removes that allocation on geometry.dispose. Track the geometries sharing
  // an instance attribute, so disposing one cannot invalidate another owner.
  const tracking = `var instanceGeometries = new WeakMap();
  var instanceAttributes = new WeakMap();

  function releaseInstanceGeometry( event ) {
    var geometry = event.target;
    var used = instanceGeometries.get( geometry );
    if ( used === undefined ) return;
    used.forEach( function ( attribute ) {
      var owners = instanceAttributes.get( attribute );
      if ( owners !== undefined ) {
        owners.delete( geometry );
        if ( owners.size === 0 ) {
          attributes.remove( attribute );
          instanceAttributes.delete( attribute );
        }
      }
    } );
    geometry.removeEventListener( 'dispose', releaseInstanceGeometry );
    instanceGeometries.delete( geometry );
  }

  function retainInstanceAttribute( geometry, attribute ) {
    var used = instanceGeometries.get( geometry );
    if ( used === undefined ) {
      used = new Set(); instanceGeometries.set( geometry, used );
      geometry.addEventListener( 'dispose', releaseInstanceGeometry );
    }
    if ( used.has( attribute ) ) return;
    used.add( attribute );
    var owners = instanceAttributes.get( attribute );
    if ( owners === undefined ) { owners = new Set(); instanceAttributes.set( attribute, owners ); }
    owners.add( geometry );
  }

  `;
  source = replaceOne(source, /(function WebGLObjects\( gl, geometries, attributes, info \) \{\s*var updateList = \{\};)/g,
    '$1\n\n\t' + tracking, 'instance allocation ownership');
  source = replaceOne(source, /(if \( object\.isInstancedMesh \) \{\s*)(attributes\.update\( object\.instanceMatrix, (?:gl\.ARRAY_BUFFER|34962) \);)/g,
    '$1retainInstanceAttribute( geometry, object.instanceMatrix );\n\t\t\t$2', 'retain uploaded instance buffer');
  return source;
}

module.exports = function threeR112InstancingLoader(source) {if (this && this.cacheable) this.cacheable(); return transform(source);};
module.exports.transform = transform;
