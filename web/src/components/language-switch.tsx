import { languages, useI18n } from '@/i18n'
import { Check, Languages } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n()

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='scale-95 rounded-full'>
          <Languages className='size-[1.2rem]' />
          <span className='sr-only'>{t('language.toggle')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {languages.map((l) => (
          // lang picks the right CJK glyphs and pronunciation for each label.
          <DropdownMenuItem
            key={l.code}
            lang={l.code}
            onClick={() => setLang(l.code)}
          >
            {l.label}
            <Check
              size={14}
              className={cn('ms-auto', lang !== l.code && 'hidden')}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
