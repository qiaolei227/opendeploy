import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN/common.json';
import enUS from './locales/en-US/common.json';
import type { Language } from '@shared/types';

export async function initI18n(initialLanguage: Language): Promise<typeof i18n> {
  await i18n.use(initReactI18next).init({
    resources: {
      'zh-CN': { common: zhCN },
      'en-US': { common: enUS }
    },
    lng: initialLanguage,
    fallbackLng: 'en-US',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    react: { useSuspense: false }
  });
  return i18n;
}

export { i18n };
