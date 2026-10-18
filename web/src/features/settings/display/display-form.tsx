import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useI18n } from '@/i18n'
import { showSubmittedData } from '@/lib/show-submitted-data'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

// Labels are the i18n keys `settings.item.<id>`.
const items = [
  'recents',
  'home',
  'applications',
  'desktop',
  'downloads',
  'documents',
] as const

const displayFormSchema = z.object({
  items: z.array(z.string()).refine((value) => value.some((item) => item), {
    message: 'settings.selectAtLeastOne',
  }),
})

type DisplayFormValues = z.infer<typeof displayFormSchema>

// This can come from your database or API.
const defaultValues: Partial<DisplayFormValues> = {
  items: ['recents', 'home'],
}

export function DisplayForm() {
  const { t } = useI18n()
  const form = useForm<DisplayFormValues>({
    resolver: zodResolver(displayFormSchema),
    defaultValues,
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => showSubmittedData(data))}
        className='space-y-8'
      >
        <FormField
          control={form.control}
          name='items'
          render={() => (
            <FormItem>
              <div className='mb-4'>
                <FormLabel className='text-base'>
                  {t('config.sidebar')}
                </FormLabel>
                <FormDescription>
                  {t('settings.sidebarItemsDesc')}
                </FormDescription>
              </div>
              {items.map((item) => (
                <FormField
                  key={item}
                  control={form.control}
                  name='items'
                  render={({ field }) => {
                    return (
                      <FormItem
                        key={item}
                        className='flex flex-row items-start'
                      >
                        <FormControl>
                          <Checkbox
                            checked={field.value?.includes(item)}
                            onCheckedChange={(checked) => {
                              return checked
                                ? field.onChange([...field.value, item])
                                : field.onChange(
                                    field.value?.filter(
                                      (value) => value !== item
                                    )
                                  )
                            }}
                          />
                        </FormControl>
                        <FormLabel className='font-normal'>
                          {t(`settings.item.${item}`)}
                        </FormLabel>
                      </FormItem>
                    )
                  }}
                />
              ))}
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit'>{t('settings.updateDisplay')}</Button>
      </form>
    </Form>
  )
}
