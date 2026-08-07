import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import fr from "../locales/fr.json";

/**
 * Initialisation i18next.
 * FR seul au MVP mais structure prête pour EN/autres sans rétrofit.
 * Aucun texte UI ne doit être en dur dans les composants (ADR i18n).
 */
void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
  },
  lng: "fr",
  fallbackLng: "fr",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
