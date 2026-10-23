import { type z } from 'zod'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { type Key, useI18n } from '@/i18n'
import { listQuery } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PasswordInput } from '@/components/password-input'
import { SelectDropdown } from '@/components/select-dropdown'
import { SeatsEditor } from './seats-editor'

export type Field = {
  name: string
  label: Key
  // seats: JSON, plus polygons drawn on a camera snapshot
  type?: 'text' | 'number' | 'password' | 'json' | 'seats' | 'select'
  // select: ids of this resource become the options
  optionsFrom?: string
  // An i18n key, or a literal example such as 'pi1'
  placeholder?: string
  description?: Key
  // Locked when editing (primary keys)
  immutable?: boolean
  // Spans both columns when the form is laid out as a grid
  wide?: boolean
}

type FieldsFormProps = {
  id: string
  fields: Field[]
  schema: z.ZodType
  initial?: Record<string, unknown>
  isEdit?: boolean
  className?: string
  onValid: (values: Record<string, unknown>) => void
}

const isJson = (f: Field) => f.type === 'json' || f.type === 'seats'

const toText = (f: Field, v: unknown) => {
  if (v === undefined || v === null || f.type === 'password') return ''
  return isJson(f) ? JSON.stringify(v) : String(v)
}

// Inputs are edited as text, converted per field type, then checked with the shared zod schema.
export function FieldsForm({
  id,
  fields,
  schema,
  initial = {},
  isEdit = false,
  className = 'space-y-4',
  onValid,
}: FieldsFormProps) {
  const { t, tr } = useI18n()
  const form = useForm<Record<string, string>>({
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.name, toText(f, initial[f.name])])
    ),
  })

  const submit = (text: Record<string, string>) => {
    const values: Record<string, unknown> = {}
    for (const f of fields) {
      const v = text[f.name]
      if (f.type === 'number') values[f.name] = v === '' ? undefined : Number(v)
      else if (isJson(f)) {
        try {
          values[f.name] = JSON.parse(v)
        } catch {
          form.setError(f.name, { message: 'validation.json' })
          return
        }
      } else values[f.name] = v
    }
    const r = schema.safeParse(values)
    if (!r.success) {
      const shown = new Set<string>()
      for (const issue of r.error.issues) {
        const [name, ...rest] = issue.path.map(String)
        // First issue per field is the most basic one (e.g. length before charset).
        if (shown.has(name)) continue
        shown.add(name)
        form.setError(name, {
          message: rest.length
            ? `${rest.join('.')}: ${issue.message}`
            : issue.message,
        })
      }
      return
    }
    onValid(r.data as Record<string, unknown>)
  }

  return (
    <Form {...form}>
      <form id={id} onSubmit={form.handleSubmit(submit)} className={className}>
        {fields.map((f) => (
          <FormField
            key={f.name}
            control={form.control}
            name={f.name}
            render={({ field }) => (
              <FormItem
                className={cn('content-start', f.wide && 'sm:col-span-2')}
              >
                <FormLabel>{t(f.label)}</FormLabel>
                {f.type === 'select' ? (
                  <OptionsSelect
                    resource={f.optionsFrom ?? ''}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isEdit && f.immutable}
                  />
                ) : (
                  <>
                    {f.type === 'seats' && (
                      <SeatsEditor
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                    <FormControl>
                      {isJson(f) ? (
                        <Textarea
                          rows={4}
                          className='font-mono text-xs'
                          placeholder={f.placeholder && tr(f.placeholder)}
                          {...field}
                        />
                      ) : f.type === 'password' ? (
                        <PasswordInput
                          autoComplete='new-password'
                          placeholder={f.placeholder && tr(f.placeholder)}
                          {...field}
                        />
                      ) : (
                        <Input
                          type={f.type === 'number' ? 'number' : 'text'}
                          step='any'
                          autoComplete='off'
                          placeholder={f.placeholder && tr(f.placeholder)}
                          {...field}
                          disabled={isEdit && f.immutable}
                        />
                      )}
                    </FormControl>
                  </>
                )}
                {f.description && (
                  <FormDescription>{t(f.description)}</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </form>
    </Form>
  )
}

function OptionsSelect({
  resource,
  value,
  onChange,
  disabled,
}: {
  resource: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const { data, isPending } = useQuery(
    listQuery<{ id: string; name?: string }>(resource)
  )
  return (
    <SelectDropdown
      isControlled
      defaultValue={value}
      onValueChange={onChange}
      isPending={isPending}
      disabled={disabled}
      items={data?.map((r) => ({
        value: r.id,
        label: r.name ? `${r.id}（${r.name}）` : r.id,
      }))}
    />
  )
}
