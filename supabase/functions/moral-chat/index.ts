import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { message, brandContext } = await req.json()
    const apiKey = Deno.env.get("HUGGINGFACE_API_KEY")

    // 1. CLEAN THE DATA: Convert JSON string to a readable sentence
    const contextObj = typeof brandContext === 'string' ? JSON.parse(brandContext) : brandContext;
    const cleanContext = `
      Brand Ethics Score: ${contextObj.ethics_score}/10. 
      Summary: ${contextObj.summary}
      Better alternatives: ${contextObj.better_swaps.join(", ")}.
    `;

    // 2. USE A BETTER SYSTEM PROMPT
    const response = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "meta-llama/Llama-3.2-1B-Instruct:fastest", 
          messages: [
            { 
              role: "system", 
              content: "You are a helpful human assistant. Do not use long bulleted lists. Answer the user's question naturally using the provided context. If a score is low, explain why based ONLY on the summary." 
            },
            { role: "user", content: `Context: ${cleanContext}\n\nQuestion: ${message}` }
          ],
          temperature: 0.7, // Adds variety so it doesn't repeat
          max_tokens: 150
        }),
      }
    )

    const result = await response.json()
    const reply = result.choices?.[0]?.message?.content || "I'm processing that, one moment...";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
  }
})