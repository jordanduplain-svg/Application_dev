import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/**
 * Écran de configuration du compte d'envoi (SMTP / Gmail / Resend).
 * C'est ce compte que les workers utilisent pour expédier les candidatures.
 */

// Schéma de validation du formulaire de configuration email.
// `port` utilise `z.coerce.number()` : le champ texte renvoie une chaîne,
// qu'on convertit en nombre — sinon la validation échouerait dès la saisie.
const smtpSchema = z.object({
  provider: z.enum(['GMAIL', 'SMTP', 'RESEND']),
  host: z.string().optional(),
  port: z.coerce.number().optional(),
  username: z.string().min(1, "Requis"),
  password: z.string().min(1, "Requis"),
  fromEmail: z.string().email("Email invalide"),
});

type SmtpInput = z.infer<typeof smtpSchema>;

export default function SmtpConfigScreen() {
  const [loading, setLoading] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const router = useRouter();

  const { control, handleSubmit, watch, formState: { errors } } = useForm<SmtpInput>({
    resolver: zodResolver(smtpSchema),
    defaultValues: {
      provider: 'SMTP',
      port: 587,
    }
  });

  const provider = watch('provider');

  // Enregistre la configuration email côté API.
  // Route : /api/me/smtp (le module user est monté sous le préfixe '/api').
  const onSubmit = async (data: SmtpInput) => {
    setLoading(true);
    try {
      await api.post('/me/smtp', data);
      Alert.alert("Succès", "Configuration email enregistrée !");
      router.back();
    } catch (error: any) {
      Alert.alert("Erreur", error.message || "Impossible de sauvegarder la configuration");
    } finally {
      setLoading(false);
    }
  };

  // Test de connexion (U3) : vérifie les identifiants AVANT enregistrement,
  // pour éviter qu'une campagne entière échoue à l'envoi. Rien n'est persisté.
  const onTest = async (data: SmtpInput) => {
    setTesting(true);
    try {
      const res = await api.post('/me/smtp/test', data);
      Alert.alert('Connexion réussie ✅', res.data?.message || 'Vos identifiants SMTP sont valides.');
    } catch (error: any) {
      Alert.alert('Échec du test ❌', error.message || 'Impossible de se connecter au serveur SMTP.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      className="flex-1 bg-white"
    >
      <View className="px-6 py-4 border-b border-gray-100 flex-row items-center">
         <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Ionicons name="arrow-back" size={24} color="#111827" />
         </TouchableOpacity>
         <Text className="text-xl font-black text-gray-900">Configuration Email</Text>
      </View>

      <ScrollView className="flex-1 p-6">
        <Text className="text-gray-500 mb-8 font-medium">
          Configurez le compte qui sera utilisé par l'IA pour envoyer vos candidatures.
        </Text>

        <View className="mb-8">
          <Text className="text-sm font-bold text-gray-700 mb-3 ml-1">Fournisseur</Text>
          <View className="flex-row space-x-2">
            {['SMTP', 'GMAIL', 'RESEND'].map((p) => (
              <Controller
                key={p}
                control={control}
                name="provider"
                render={({ field: { onChange, value } }) => (
                  <TouchableOpacity 
                    onPress={() => onChange(p)}
                    className={`flex-1 h-12 rounded-xl items-center justify-center border-2 ${value === p ? 'border-blue-600 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}
                  >
                    <Text className={`font-bold ${value === p ? 'text-blue-600' : 'text-gray-400'}`}>{p}</Text>
                  </TouchableOpacity>
                )}
              />
            ))}
          </View>
        </View>

        <View className="space-y-5">
          {provider === 'SMTP' && (
            <View className="flex-row space-x-4">
              <View className="flex-3">
                 <FormInput control={control} name="host" label="Hôte SMTP" placeholder="smtp.mon-serveur.com" error={errors.host} />
              </View>
              <View className="flex-1">
                 <FormInput control={control} name="port" label="Port" placeholder="587" keyboardType="numeric" error={errors.port} />
              </View>
            </View>
          )}

          <FormInput control={control} name="fromEmail" label="Email d'expédition" placeholder="jean@candidat.fr" error={errors.fromEmail} />
          <FormInput control={control} name="username" label="Nom d'utilisateur / Clé API" placeholder="Utilisateur" error={errors.username} />
          <FormInput control={control} name="password" label="Mot de passe / Secret" placeholder="••••••••" secureTextEntry error={errors.password} />
        </View>

        <View className="mt-10 p-5 bg-blue-50 rounded-2xl border border-blue-100 flex-row">
           <Ionicons name="shield-checkmark" size={24} color="#2563EB" />
           <Text className="text-blue-800 text-xs flex-1 ml-3 leading-relaxed font-medium">
             Vos identifiants sont cryptés bout-en-bout et utilisés uniquement pour l'envoi de vos candidatures ciblées.
           </Text>
        </View>

        <View className="h-20" />
      </ScrollView>

      <View className="p-6 border-t border-gray-100 bg-white flex-row space-x-3">
        <TouchableOpacity
          onPress={handleSubmit(onTest)}
          disabled={testing || loading}
          className={`flex-1 h-16 rounded-2xl items-center justify-center border-2 ${
            testing || loading ? 'border-gray-200 opacity-50' : 'border-blue-600'
          }`}
        >
          {testing ? (
            <ActivityIndicator color="#2563EB" />
          ) : (
            <Text className="text-blue-600 text-base font-bold">Tester</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSubmit(onSubmit)}
          disabled={loading || testing}
          className={`flex-[2] h-16 rounded-2xl items-center justify-center ${
            loading || testing ? 'bg-blue-300' : 'bg-blue-600'
          }`}
        >
          {loading ? <ActivityIndicator color="white" /> : <Text className="text-white text-lg font-bold">Sauvegarder</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// Champ de formulaire contrôlé par react-hook-form (label + input + erreur).
function FormInput({ control, name, label, error, ...props }: any) {
  return (
    <View className="mb-4">
      <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">{label}</Text>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            onBlur={onBlur}
            onChangeText={onChange}
            value={value?.toString()}
            className={`w-full h-14 border ${error ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50'} rounded-2xl px-5 text-gray-900`}
            {...props}
          />
        )}
      />
      {error && <Text className="text-red-500 text-xs mt-1 ml-1 font-medium">{error.message}</Text>}
    </View>
  );
}
