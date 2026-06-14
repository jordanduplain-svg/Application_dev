import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Pressable, Linking } from 'react-native';
import { useRouter, Link } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, RegisterInput, LEGAL_URLS } from '@candio/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/constants/authStore';
import { Ionicons } from '@expo/vector-icons';

/**
 * Écran d'inscription.
 * Formulaire validé via react-hook-form + le schéma Zod partagé
 * `registerSchema`. En cas de succès, l'utilisateur est directement connecté.
 */
export default function RegisterScreen() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  
  const router = useRouter();
  const setAuth = useAuthStore(state => state.setAuth);

  const { control, handleSubmit, formState: { errors, isValid } } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
  });

  // Soumission du formulaire : crée le compte puis connecte l'utilisateur.
  const onSubmit = async (data: RegisterInput) => {
    setLoading(true);
    setApiError(null);
    try {
      const response = await api.post('/auth/register', data);
      const { user, accessToken, refreshToken } = response.data;
      // Stocke l'utilisateur + les deux tokens ; _layout.tsx bascule alors vers l'app.
      setAuth(user, accessToken, refreshToken);
    } catch (error: any) {
      // `error.message` est déjà formaté par l'intercepteur axios (cf. lib/api.ts).
      setApiError(error.message || 'Une erreur est survenue lors de l\'inscription');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      className="flex-1 bg-white"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingVertical: 40 }}>
        <View className="mb-10">
          <Text className="text-4xl font-extrabold text-blue-600 tracking-tight">Bienvenue</Text>
          <Text className="text-xl text-gray-500 mt-2 font-medium">Créez votre compte Candio</Text>
        </View>

        {apiError && (
          <View className="bg-red-50 p-4 rounded-xl mb-6 border border-red-100 flex-row items-center">
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
            <Text className="text-red-500 ml-2 font-medium">{apiError}</Text>
          </View>
        )}

        <View className="flex-row space-x-4">
          <View className="flex-1">
            <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">Prénom</Text>
            <Controller
              control={control}
              name="firstName"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  placeholder="Jean"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  className={`w-full h-12 border ${errors.firstName ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50'} rounded-xl px-4 text-gray-900`}
                />
              )}
            />
            {errors.firstName && <Text className="text-red-500 text-[10px] mt-1 ml-1 font-medium">{errors.firstName.message}</Text>}
          </View>

          <View className="flex-1">
            <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">Nom</Text>
            <Controller
              control={control}
              name="lastName"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  placeholder="Dupont"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  className={`w-full h-12 border ${errors.lastName ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50'} rounded-xl px-4 text-gray-900`}
                />
              )}
            />
            {errors.lastName && <Text className="text-red-500 text-[10px] mt-1 ml-1 font-medium">{errors.lastName.message}</Text>}
          </View>
        </View>

        <View className="mt-5">
          <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">Email</Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                placeholder="votre@email.com"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                autoCapitalize="none"
                keyboardType="email-address"
                className={`w-full h-14 border ${errors.email ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50'} rounded-2xl px-5 text-gray-900 text-base`}
              />
            )}
          />
          {errors.email && <Text className="text-red-500 text-xs mt-1 ml-1 font-medium">{errors.email.message}</Text>}
        </View>

        <View className="mt-5">
          <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">Mot de passe</Text>
          <View className="relative">
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  placeholder="••••••••"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  secureTextEntry={!showPassword}
                  className={`w-full h-14 border ${errors.password ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50'} rounded-2xl px-5 pr-12 text-gray-900 text-base`}
                />
              )}
            />
            <Pressable 
              onPress={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-4"
            >
              <Ionicons name={showPassword ? "eye-off" : "eye"} size={22} color="#9CA3AF" />
            </Pressable>
          </View>
          {errors.password && <Text className="text-red-500 text-xs mt-1 ml-1 font-medium">{errors.password.message}</Text>}
        </View>

        {/* Consentement CGU obligatoire (S4) : tant que la case n'est pas
            cochée, `acceptTos` est invalide → le bouton reste désactivé. */}
        <Controller
          control={control}
          name="acceptTos"
          render={({ field: { onChange, value } }) => (
            <TouchableOpacity
              onPress={() => onChange(!value)}
              activeOpacity={0.7}
              className="flex-row items-start mt-6"
            >
              <View
                className={`w-6 h-6 rounded-md border-2 items-center justify-center mr-3 mt-0.5 ${
                  value ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                }`}
              >
                {value && <Ionicons name="checkmark" size={16} color="white" />}
              </View>
              <Text className="flex-1 text-gray-500 text-sm leading-relaxed">
                J'accepte les{' '}
                <Text
                  className="text-blue-600 font-bold"
                  onPress={() => Linking.openURL(LEGAL_URLS.terms)}
                >
                  conditions d'utilisation
                </Text>{' '}
                et la{' '}
                <Text
                  className="text-blue-600 font-bold"
                  onPress={() => Linking.openURL(LEGAL_URLS.privacy)}
                >
                  politique de confidentialité
                </Text>
                .
              </Text>
            </TouchableOpacity>
          )}
        />
        {errors.acceptTos && (
          <Text className="text-red-500 text-xs mt-2 ml-1 font-medium">
            {errors.acceptTos.message}
          </Text>
        )}

        <TouchableOpacity
          onPress={handleSubmit(onSubmit)}
          disabled={loading || !isValid}
          className={`w-full h-15 rounded-2xl justify-center items-center mt-10 ${
            (loading || !isValid) ? 'bg-blue-300' : 'bg-blue-600'
          }`}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-lg font-bold">Créer mon compte</Text>
          )}
        </TouchableOpacity>

        <View className="flex-row justify-center mt-10 mb-10 items-center">
          <Text className="text-gray-500">Déjà inscrit ? </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text className="text-blue-600 font-bold ml-1">Se connecter</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
