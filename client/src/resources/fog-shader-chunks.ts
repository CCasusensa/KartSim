import { ShaderChunk } from "three";

/**
 * The release's fog chunks (Vr0): linear fog by view depth, EXP by view
 * depth, and EXP2 by distance from the camera. The release interpolated that
 * distance from the vertices (`length(mvPosition.xyz)` per vertex), which is
 * only right on small triangles. On a large one every pixel reads about the
 * corners' distance: pirate_R05's sea planes (4-vertex quads over 2 km wide)
 * drew fully fogged, a flat white sheet under the turquoise horizon. The view
 * position is interpolated instead, so the distance is exact per pixel.
 */
export function installTrackFogChunks(): void {
  if (installed) return;
  installed = true;
  ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG

	varying float vFogDepth;
	varying vec3 vFogViewPosition;

#endif
`;
  ShaderChunk.fog_vertex = `
#ifdef USE_FOG

	vFogDepth = - mvPosition.z;
	vFogViewPosition = mvPosition.xyz;

#endif
`;
  ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG

	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogViewPosition;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

#endif
`;
  ShaderChunk.fog_fragment = `
#ifdef USE_FOG

	#ifdef FOG_EXP2

		bool expFog = fogDensity < 0.0;
		float density = abs( fogDensity );
		float fogDist = expFog ? vFogDepth : length( vFogViewPosition );
		float fogFactor = expFog
			? 1.0 - exp( - density * fogDist )
			: 1.0 - exp( - density * density * fogDist * fogDist );

	#else

		float fogFactor = clamp( ( vFogDepth - fogNear ) / ( fogFar - fogNear ), 0.0, 1.0 );

	#endif

	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

#endif
`;
}

let installed = false;
