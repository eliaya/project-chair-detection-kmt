import { useI18n } from '@/i18n'
import { ContentSection } from '../components/content-section'
import { DisplayForm } from './display-form'

export function SettingsDisplay() {
  const { t } = useI18n()
  return (
    <ContentSection title={t('nav.display')} desc={t('settings.displayDesc')}>
      <DisplayForm />
    </ContentSection>
  )
}
