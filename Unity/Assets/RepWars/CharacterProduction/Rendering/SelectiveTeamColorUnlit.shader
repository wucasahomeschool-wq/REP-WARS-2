Shader "RepWars/CharacterProduction/SelectiveTeamColorUnlit"
{
    Properties
    {
        [PerRendererData] _MainTex ("Sprite Texture", 2D) = "white" {}
        [PerRendererData] _TeamColorMask ("Explicit Recolor Mask (R)", 2D) = "black" {}
        [PerRendererData] _TeamColor ("Technical Team Color (Linear RGB)", Vector) = (1,1,1,1)
        [PerRendererData] _TeamColorEnabled ("Recolor Enabled", Float) = 0
        [HideInInspector] _Color ("Tint (Keep White)", Color) = (1,1,1,1)
        [HideInInspector] _RendererColor ("RendererColor", Color) = (1,1,1,1)
        [HideInInspector] _AlphaTex ("External Alpha", 2D) = "white" {}
        [HideInInspector] _EnableExternalAlpha ("Enable External Alpha", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
        Cull Off
        ZWrite Off
        Pass
        {
            Tags { "LightMode"="Universal2D" }
            HLSLPROGRAM
            // Vertex path follows URP 17.6 Sprite-Unlit-Default (including GPU SpriteSkin).
            #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/Core2D.hlsl"
            #pragma vertex TeamVertex
            #pragma fragment TeamFragment
            #pragma multi_compile_instancing
            #pragma multi_compile _ DEBUG_DISPLAY SKINNED_SPRITE
            struct Attributes
            {
                COMMON_2D_INPUTS
                half4 color : COLOR;
                UNITY_SKINNED_VERTEX_INPUTS
            };
            struct Varyings
            {
                COMMON_2D_OUTPUTS
                half4 color : COLOR;
            };
            #include "Packages/com.unity.render-pipelines.universal/Shaders/2D/Include/2DCommon.hlsl"
            TEXTURE2D(_TeamColorMask);
            SAMPLER(sampler_TeamColorMask);
            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                float4 _TeamColor;
                float _TeamColorEnabled;
            CBUFFER_END
            Varyings TeamVertex(Attributes input)
            {
                UNITY_SKINNED_VERTEX_COMPUTE(input);
                SetUpSpriteInstanceProperties();
                input.positionOS = UnityFlipSprite(input.positionOS, unity_SpriteProps.xy);
                Varyings o = CommonUnlitVertex(input);
                o.color = input.color * _Color * unity_SpriteColor;
                return o;
            }
            half4 TeamFragment(Varyings input) : SV_Target
            {
                half4 original = CommonUnlitFragment(input, input.color);
                #if defined(DEBUG_DISPLAY)
                    return original;
                #endif
                float amount = saturate(SAMPLE_TEXTURE2D(_TeamColorMask, sampler_TeamColorMask, input.uv).r * _TeamColorEnabled);
                // Exact original output for all unmasked pixels and disabled mode (no color-space round trip).
                if (amount <= 0.0) return original;
                float3 painted = original.rgb;
                #if defined(UNITY_COLORSPACE_GAMMA)
                    painted = SRGBToLinear(painted);
                #endif
                const float3 coefficients = float3(0.2126, 0.7152, 0.0722);
                float value = saturate(dot(painted, coefficients));
                float teamValue = dot(_TeamColor.rgb, coefficients);
                float amplitude = min(value / max(teamValue, 0.00001), (1.0-value) / max(1.0-teamValue, 0.00001));
                float3 target = value.xxx + (_TeamColor.rgb - teamValue.xxx) * amplitude;
                float3 result = lerp(painted, target, amount);
                #if defined(UNITY_COLORSPACE_GAMMA)
                    result = LinearToSRGB(result);
                #endif
                return half4(result, original.a);
            }
            ENDHLSL
        }
    }
}
