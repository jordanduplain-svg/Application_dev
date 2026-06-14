import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native';
import { useRouter, Link } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, LoginInput } from '@candio/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/constants/authStore';
import { Ionicons } from '@expo/vector-icons';

/**
 * Écran de connexion.
 * Le formulaire est validé en temps réel via react-hook-form + le schéma Zod
 * partagé `loginSchema`. En cas de succès, le store d'auth est rempli et la
 * redirection vers l'app est gérée par _layout.tsx.
 */
export default function LoginScreen() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  
  const router = useRouter();
  const setAuth = useAuthStore(state => state.setAuth);

  const { control, handleSubmit, formState: { errors, isValid } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: 'onChange',
  });

  // Soumission du formulaire : appelle l'API puis remplit le store d'auth.
  const onSubmit = async (data: LoginInput) => {
    setLoading(true);
    setApiError(null);
    try {
      const response = await api.post('/auth/login', data);
      const { user, accessToken, refreshToken } = response.data;
      // Stocke l'utilisateur + les deux tokens ; _layout.tsx bascule alors vers l'app.
      setAuth(user, accessToken, refreshToken);
    } catch (error: any) {
      // `error.message` est déjà formaté par l'intercepteur axios (cf. lib/api.ts).
      setApiError(error.message || 'Identifiants invalides');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      className="flex-1 bg-white"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        <View className="mb-10">
          <Text className="text-5xl font-extrabold text-blue-600 tracking-tight">Candio</Text>
          <Text className="text-xl text-gray-500 mt-3 font-medium">Connectez-vous pour continuer</Text>
        </View>

        {apiError && (
          <View className="bg-red-50 p-4 rounded-xl mb-6 border border-red-100 flex-row items-center">
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
            <Text className="text-red-500 ml-2 font-medium">{apiError}</Text>
          </View>
        )}

        <View>
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

        <Link href="/(auth)/forgot-password" asChild>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} className="self-end mt-3">
            <Text className="text-blue-600 font-bold text-sm">Mot de passe oublié ?</Text>
          </TouchableOpacity>
        </Link>

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
            <Text className="text-white text-lg font-bold">Se connecter</Text>
          )}
        </TouchableOpacity>

        <View className="flex-row justify-center mt-10 items-center">
          <Text className="text-gray-500">Pas encore de compte ? </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text className="text-blue-600 font-bold ml-1">S'inscrire</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
