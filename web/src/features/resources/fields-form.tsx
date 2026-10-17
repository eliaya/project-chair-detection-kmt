import { type z } from 'zod'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { listQuery } from '@/lib/api'
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

export type Field = {
  name: string
  label: string
  type?: 'text' | 'number' | 'password' | 'json' | 'select'
  // select: ids of this resource become the options
  optionsFrom?: string
  placeholder?: string
  description?: string
  // Locked when editing (primary keys)
  immutable?: boolean
}

type FieldsFormProps = {
  id: string
  fields: Field[]
  schema: z.ZodType
  initial?: Record<string, unknown>
  isEdit?: boolean
  onValid: (values: Record<string, unknown>) => void
}

const toText = (f: Field, v: unknown) => {
  if (v === undefined || v === null || f.type === 'password') return ''
  return f.type === 'json' ? JSON.stringify(v) : String(v)
}

// Inputs are edited as text, converted per field type, then checked with the shared zod schema.
export function FieldsForm({
  id,
  fields,
  schema,
  initial = {},
  isEdit = false,
  onValid,
}: FieldsFormProps) {
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
      else if (f.type === 'json') {
        try {
          values[f.name] = JSON.parse(v)
        } catch {
          form.setError(f.name, { message: 'JSON 形式が正しくありません' })
          return
        }
      } else values[f.name] = v
    }
    const r = schema.safeParse(values)
    if (!r.success) {
      for (const issue of r.error.issues) {
        const [name, ...rest] = issue.path.map(String)
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
      <form id={id} onSubmit={form.handleSubmit(submit)} className='space-y-4'>
        {fields.map((f) => (
          <FormField
            key={f.name}
            control={form.control}
            name={f.name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{f.label}</FormLabel>
                {f.type === 'select' ? (
                  <OptionsSelect
                    resource={f.optionsFrom ?? ''}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isEdit && f.immutable}
                  />
                ) : (
                  <FormControl>
                    {f.type === 'json' ? (
                      <Textarea
                        rows={4}
                        className='font-mono text-xs'
                        placeholder={f.placeholder}
                        {...field}
                      />
                    ) : f.type === 'password' ? (
                      <PasswordInput
                        autoComplete='new-password'
                        placeholder={f.placeholder}
                        {...field}
                      />
                    ) : (
                      <Input
                        type={f.type === 'number' ? 'number' : 'text'}
                        step='any'
                        autoComplete='off'
                        placeholder={f.placeholder}
                        {...field}
                        disabled={isEdit && f.immutable}
                      />
                    )}
                  </FormControl>
                )}
                {f.description && (
                  <FormDescription>{f.description}</FormDescription>
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
      placeholder='選択してください'
      items={data?.map((r) => ({
        value: r.id,
        label: r.name ? `${r.id}（${r.name}）` : r.id,
      }))}
    />
  )
}
