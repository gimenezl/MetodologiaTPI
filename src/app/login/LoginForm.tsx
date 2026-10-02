'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/services/supabase'
import { destinoPanelSeguro } from '@/lib/redireccion-login'
import { loginSchema, LoginFormData } from '@/lib/validations'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = destinoPanelSeguro(searchParams.get('redirect'))

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
  })

  const onSubmit = async ({ email, password }: LoginFormData) => {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // EPT-59: una cuenta bloqueada por Dirección queda baneada en Auth. El
      // texto de GoTrue llega en inglés, así que se muestra uno propio por código.
      const mensajes: Record<string, string> = {
        invalid_credentials: 'Email o contraseña incorrectos',
        user_banned: 'Tu acceso está bloqueado. Comunicate con Dirección.',
        email_not_confirmed: 'Tu correo todavía no está confirmado. Comunicate con Dirección.',
        over_request_rate_limit: 'Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.',
      }
      toast.error(
        (error.code && mensajes[error.code]) ??
          (error.message === 'Invalid login credentials'
            ? mensajes.invalid_credentials
            : 'No pudimos iniciar sesión. Intentá de nuevo en unos minutos.')
      )
      return
    }
    toast.success('Bienvenido al sistema')
    router.push(redirect)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <Input
        label="Email institucional"
        type="email"
        required
        placeholder="usuario@institucion.edu.ar"
        autoComplete="email"
        {...register('email')}
        error={errors.email?.message}
      />
      <Input
        label="Contraseña"
        type="password"
        required
        placeholder="••••••••"
        autoComplete="current-password"
        {...register('password')}
        error={errors.password?.message}
      />
      <Button type="submit" fullWidth loading={isSubmitting} className="mt-2">
        Ingresar al sistema
      </Button>
    </form>
  )
}
