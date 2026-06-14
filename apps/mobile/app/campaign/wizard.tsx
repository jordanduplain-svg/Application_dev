import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/constants/authStore';
import { useCampaignWizardStore } from '@/stores/campaignWizard.store';
import { api } from '@/lib/api';
import { Ionicons } from '@expo/vector-icons';
import { z } from 'zod';
import * as DocumentPicker from 'expo-document-picker';
import { PRICE_PER_APPLICATION } from '@candio/shared';

/**
 * Assistant (wizard) de création de campagne, en 5 étapes :
 *  1. Informations  2. CV  3. Prompt IA  4. Quota  5. Récapitulatif/Paiement.
 * L'état est conservé dans le store `useCampaignWizardStore` (persisté).
 * Chaque étape est validée par son propre schéma Zod avant de passer à la suivante.
 */

// Un schéma de validation Zod par étape.
const WizardStep1Schema = z
  .object({
    name: z.string().min(3, "Le nom doit faire au moins 3 caractères"),
    jobTitle: z.string().min(3, "L'intitulé est requis"),
    location: z.string().min(2, "La localisation est requise"),
    contractTypes: z.array(z.string()).min(1, "Choisissez au moins un type de contrat"),
    // Bornes alignées sur le schéma serveur (createCampaignSchema) : retour
    // immédiat à l'étape 1 au lieu d'un rejet tardif à l'étape « Payer » (#5).
    salaryMin: z.number().int().min(0).max(10_000_000, 'Salaire trop élevé').optional(),
    salaryMax: z.number().int().min(0).max(10_000_000, 'Salaire trop élevé').optional(),
  })
  .refine(
    (d) => d.salaryMin == null || d.salaryMax == null || d.salaryMin <= d.salaryMax,
    { message: 'Le salaire minimum ne peut pas dépasser le maximum', path: ['salaryMax'] }
  );

// Types de contrat proposés (sélection multiple à l'étape 1).
const CONTRACT_TYPES = ['CDI', 'CDD', 'Freelance', 'Alternance', 'Stage'];

// Convertit une saisie de salaire en entier, ou `undefined` si vide/invalide.
function parseSalary(value: string): number | undefined {
  const digits = value.replace(/\D/g, '');
  if (!digits) return undefined;
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? undefined : n;
}

const WizardStep2Schema = z.object({
  cvFile: z.object({
    name: z.string(),
    uri: z.string(),
  }, { required_error: "Veuillez uploader votre CV" }),
});

const WizardStep3Schema = z.object({
  prompt: z.string().min(100, "Le prompt doit faire au moins 100 caractères pour être efficace"),
});

const WizardStep4Schema = z.object({
  applicationQuota: z.number().min(10, "Minimum 10 candidatures").max(1000),
});

export default function CampaignWizardScreen() {
  const { step, data, setStep, setData, reset } = useCampaignWizardStore();
  const [loading, setLoading] = useState(false);
  // Mémorise si le CV a déjà été uploadé : évite un ré-upload (et un fichier
  // dupliqué côté serveur) lorsqu'on relance `handleCreate` après une erreur.
  const cvUploadedRef = React.useRef(false);
  const router = useRouter();

  const totalSteps = 5;

  // Garde de configuration (U2) : le compte d'envoi d'emails doit être
  // configuré, sinon TOUTES les candidatures de la campagne échoueraient
  // (« SMTP not configured »). On charge le profil pour le vérifier.
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => (await api.get('/me')).data,
  });

  // Valide l'étape courante avec son schéma Zod ; en cas d'erreur, affiche
  // le premier message de validation et bloque la progression.
  const handleNext = () => {
    try {
      if (step === 1) WizardStep1Schema.parse(data);
      if (step === 2) WizardStep2Schema.parse({ cvFile: data.cvFile });
      if (step === 3) WizardStep3Schema.parse({ prompt: data.prompt });
      if (step === 4) WizardStep4Schema.parse(data);
      setStep(step + 1);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        Alert.alert("Validation", err.errors[0].message);
      }
    }
  };

  // Ajoute ou retire un type de contrat de la sélection.
  const toggleContractType = (contractType: string) => {
    const current = data.contractTypes;
    setData({
      contractTypes: current.includes(contractType)
        ? current.filter((c) => c !== contractType)
        : [...current, contractType],
    });
  };

  // Ouvre le sélecteur de fichiers et mémorise le CV choisi dans le store.
  // PDF uniquement : l'API et le worker d'analyse (pdf-parse) ne gèrent que ce
  // format — proposer .doc/.docx mènerait à un échec silencieux du parsing.
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
      });

      if (!result.canceled) {
        setData({ 
          cvFile: { 
            name: result.assets[0].name, 
            uri: result.assets[0].uri,
            size: result.assets[0].size 
          } 
        });
      }
    } catch (err) {
      Alert.alert('Erreur', "Impossible d'ouvrir le sélecteur de fichiers");
    }
  };

  // Étape finale : upload du CV, création de la campagne, puis paiement.
  const handleCreate = async () => {
    setLoading(true);
    try {
      // 1. Upload du CV choisi à l'étape 2 (sinon il serait perdu).
      // Sauté si déjà fait lors d'une tentative précédente de cette session.
      if (data.cvFile && !cvUploadedRef.current) {
        const cvForm = new FormData();
        // @ts-ignore — forme de fichier attendue par FormData en React Native
        cvForm.append('cv', {
          uri: data.cvFile.uri,
          name: data.cvFile.name,
          type: 'application/pdf',
        });
        await api.post('/me/cv', cvForm, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        cvUploadedRef.current = true;
      }

      // 2. Création de la campagne : on n'envoie QUE les champs attendus par
      // `createCampaignSchema` (qui est strict). `cvFile` et `budget` en sont
      // exclus — le budget est recalculé côté serveur.
      const campaignRes = await api.post('/campaigns', {
        name: data.name,
        prompt: data.prompt,
        jobTitle: data.jobTitle,
        location: data.location,
        contractTypes: data.contractTypes,
        salaryMin: data.salaryMin,
        salaryMax: data.salaryMax,
        applicationQuota: data.applicationQuota,
      });

      // 3. Paiement (mocké) : le serveur marque directement la campagne PAID.
      await api.post(`/stripe/checkout/${campaignRes.data.id}`);

      reset();
      router.replace('/campaign/payment-success');
    } catch (error: any) {
      Alert.alert('Erreur', error.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  const handleAbandon = () => {
    Alert.alert("Abandonner ?", "Quitter l'assistant ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Quitter", onPress: () => router.back(), style: "destructive" }
    ]);
  };

  // Pendant le chargement du profil : écran d'attente neutre.
  if (profileLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  // Compte d'envoi non configuré → on bloque l'assistant et on oriente
  // l'utilisateur vers la configuration SMTP.
  if (profile && !profile.emailSender) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-10">
        <View className="w-24 h-24 bg-amber-100 rounded-full items-center justify-center mb-8">
          <Ionicons name="mail-outline" size={56} color="#D97706" />
        </View>
        <Text className="text-2xl font-black text-gray-900 text-center">
          Configuration requise
        </Text>
        <Text className="text-gray-500 text-center mt-4 font-medium leading-relaxed">
          Configurez d'abord votre compte d'envoi d'emails : sans lui, vos
          candidatures ne pourraient pas être expédiées.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/settings/smtp')}
          className="mt-10 bg-blue-600 w-full h-16 rounded-2xl items-center justify-center"
        >
          <Text className="text-white text-lg font-bold">Configurer l'envoi d'emails</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="text-gray-500 font-bold">Plus tard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1 bg-white">
      <View className="flex-row items-center justify-between px-6 py-4 border-b border-gray-100">
        <TouchableOpacity onPress={handleAbandon}><Ionicons name="close" size={28} color="#4B5563" /></TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">Étape {step}/{totalSteps}</Text>
        <View className="w-8" />
      </View>

      <ScrollView className="flex-1 p-6">
        <View className="mb-6 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
           <View style={{ width: `${(step / totalSteps) * 100}%` }} className="h-full bg-blue-600" />
        </View>

        {step === 1 && (
          <View>
            <Text className="text-2xl font-bold text-gray-900 mb-2">Informations</Text>
            <Input label="Nom" value={data.name} onChange={(v) => setData({name: v})} placeholder="Ex: Recrutement Dev" />
            <Input label="Poste" value={data.jobTitle} onChange={(v) => setData({jobTitle: v})} placeholder="Ex: Frontend Dev" />
            <Input label="Lieu" value={data.location} onChange={(v) => setData({location: v})} placeholder="Ex: Paris" />

            <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">Types de contrat</Text>
            <View className="flex-row flex-wrap mb-6">
              {CONTRACT_TYPES.map((ct) => {
                const selected = data.contractTypes.includes(ct);
                return (
                  <TouchableOpacity
                    key={ct}
                    onPress={() => toggleContractType(ct)}
                    className={`px-4 py-2 rounded-full mr-2 mb-2 border-2 ${
                      selected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <Text className={`font-bold ${selected ? 'text-blue-600' : 'text-gray-400'}`}>
                      {ct}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">
              Fourchette de salaire (€/an, optionnel)
            </Text>
            <View className="flex-row">
              <View className="flex-1 mr-2">
                <TextInput
                  value={data.salaryMin?.toString() ?? ''}
                  onChangeText={(v) => setData({ salaryMin: parseSalary(v) })}
                  keyboardType="numeric"
                  placeholder="Min"
                  className="w-full h-14 border border-gray-200 rounded-2xl px-5 bg-gray-50"
                />
              </View>
              <View className="flex-1 ml-2">
                <TextInput
                  value={data.salaryMax?.toString() ?? ''}
                  onChangeText={(v) => setData({ salaryMax: parseSalary(v) })}
                  keyboardType="numeric"
                  placeholder="Max"
                  className="w-full h-14 border border-gray-200 rounded-2xl px-5 bg-gray-50"
                />
              </View>
            </View>
          </View>
        )}

        {step === 2 && (
          <View>
            <Text className="text-2xl font-bold text-gray-900 mb-2">Votre CV</Text>
            <TouchableOpacity onPress={pickDocument} className={`w-full h-48 border-2 border-dashed rounded-[32px] items-center justify-center ${data.cvFile ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
              <Ionicons name={data.cvFile ? "checkmark-done" : "cloud-upload-outline"} size={32} color={data.cvFile ? "#22C55E" : "#9CA3AF"} />
              <Text className="font-bold mt-2">{data.cvFile ? 'CV Sélectionné' : 'Choisir un fichier'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 3 && (
          <View>
            <Text className="text-2xl font-bold text-gray-900 mb-2">Prompt IA</Text>
            <TextInput value={data.prompt} onChangeText={(v) => setData({prompt: v})} multiline className="w-full border border-gray-200 rounded-2xl px-5 py-4 bg-gray-50 h-48" />
            <Text className="text-right text-xs mt-2">{data.prompt.length} / 100 min</Text>
          </View>
        )}

        {step === 4 && (
          <View>
            <Text className="text-2xl font-bold text-gray-900 mb-2">Quota</Text>
            <View className="bg-blue-50 p-8 rounded-[32px] items-center border border-blue-100">
               <Text className="text-blue-700 text-6xl font-black">{data.applicationQuota}</Text>
               <View className="flex-row mt-6 space-x-6">
                 <TouchableOpacity onPress={() => setData({applicationQuota: Math.max(10, data.applicationQuota - 10)})} className="w-12 h-12 bg-white rounded-full items-center justify-center"><Ionicons name="remove" size={24} color="#2563EB" /></TouchableOpacity>
                 <TouchableOpacity onPress={() => setData({applicationQuota: data.applicationQuota + 10})} className="w-12 h-12 bg-white rounded-full items-center justify-center"><Ionicons name="add" size={24} color="#2563EB" /></TouchableOpacity>
               </View>
            </View>
          </View>
        )}

        {step === 5 && (
          <View>
            <Text className="text-2xl font-bold text-gray-900 mb-2">Récapitulatif</Text>
            <View className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
              <RecapItem label="Campagne" value={data.name} />
              <RecapItem label="Poste" value={data.jobTitle} />
              <RecapItem label="Contrats" value={data.contractTypes.join(', ')} />
              <RecapItem label="Budget" value={`${(data.applicationQuota * PRICE_PER_APPLICATION).toFixed(2)} €`} highlight />
            </View>
          </View>
        )}
      </ScrollView>

      <View className="p-6 border-t border-gray-100 flex-row space-x-4 bg-white">
        {step > 1 && <TouchableOpacity onPress={() => setStep(step - 1)} className="flex-1 bg-gray-100 h-16 rounded-2xl items-center justify-center"><Text className="text-gray-600 font-bold">Retour</Text></TouchableOpacity>}
        <TouchableOpacity onPress={step === totalSteps ? handleCreate : handleNext} disabled={loading} className="flex-[2] bg-blue-600 h-16 rounded-2xl items-center justify-center">{loading ? <ActivityIndicator color="white" /> : <Text className="text-white font-bold">{step === totalSteps ? 'Payer' : 'Continuer'}</Text>}</TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// Props du champ de saisie réutilisable du wizard.
interface InputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  [key: string]: any; // props supplémentaires transmises au TextInput
}

// Champ de saisie réutilisable (label + TextInput) des étapes du wizard.
function Input({ label, value, onChange, ...props }: InputProps) {
  return (
    <View className="mb-6">
      <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">{label}</Text>
      <TextInput value={value} onChangeText={onChange} className="w-full h-14 border border-gray-200 rounded-2xl px-5 bg-gray-50" {...props} />
    </View>
  );
}

// Ligne « libellé / valeur » de l'écran récapitulatif (étape 5).
function RecapItem({ label, value, highlight = false }: any) {
  return (
    <View className="flex-row justify-between items-center mb-1">
      <Text className="text-gray-500">{label}</Text>
      <Text className={`font-bold ${highlight ? 'text-blue-600' : 'text-gray-900'}`}>{value}</Text>
    </View>
  );
}
