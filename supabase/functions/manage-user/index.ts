// supabase/functions/manage-user/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';

// === CONFIGURACIÓN DE VARIABLES ===
// Nunca escribir llaves en el código: se leen de los "secrets" de Supabase.
// FISHMAR_SECRET_KEY = llave secreta nueva (sb_secret_...), configurada en
// Dashboard → Edge Functions → Secrets.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('FISHMAR_SECRET_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltan variables de entorno: SUPABASE_URL y FISHMAR_SECRET_KEY');
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Headers CORS completos
function corsHeaders(origin?: string | null) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-client-info, apikey',
    'Access-Control-Max-Age': '86400',
  };
}

serve(async (req) => {
  const origin = req.headers.get('origin');

  // Manejar preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  try {
    // 1. Verificar autenticación
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    // 2. Verificar que sea superadmin
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('is_superadmin')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData?.is_superadmin) {
      return new Response(JSON.stringify({ error: 'Acceso denegado: solo superadmin' }), {
        status: 403,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    // 3. Procesar acción
    const { action, email, role, fullName, userId, password } = await req.json();

    if (action === 'create') {
      // Crear usuario en auth
      const createOptions: any = {
        email,
        email_confirm: true, // Confirma automáticamente el correo
        user_metadata: { full_name: fullName },
      };
      if (password && password.trim() !== '') {
        createOptions.password = password; // Si se proporciona, no se envía correo de invitación
      }
      // Si no hay password, Supabase enviará automáticamente un correo de invitación

      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser(createOptions);
      if (authError) throw new Error(authError.message);

      // Insertar en user_roles
      const { error: roleInsertError } = await supabaseAdmin
        .from('user_roles')
        .insert({ user_id: authUser.user.id, role, full_name: fullName, is_superadmin: false });
      if (roleInsertError) {
        // Si falla, revertir creación
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
        throw new Error(roleInsertError.message);
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    if (action === 'delete') {
      // Eliminar de user_roles primero
      const { error: roleDeleteError } = await supabaseAdmin
        .from('user_roles')
        .delete()
        .eq('user_id', userId);
      if (roleDeleteError) throw new Error(roleDeleteError.message);

      // Eliminar de auth
      const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (authDeleteError) throw new Error(authDeleteError.message);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Acción no válida' }), {
      status: 400,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    });
  }
});