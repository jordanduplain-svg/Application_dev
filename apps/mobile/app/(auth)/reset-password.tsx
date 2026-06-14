import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Pressable,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/api';
import { Ionicons } from '@expo/vector-icons';

/**
 * Écran de réinitialisation du mot de passe (S1, étape 2).
 * L'utilisateur saisit le code à 6 chiffres reçu par email et son nouveau
 * mot de passe.
 */
export default function ResetPasswordScreen() {
  // `email` est transmis depuis l'écran « Mot de passe oublié ».
  const { email } = useLocalSearchParams<{ email: string }>();
  const router = useRouter();

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validations alignées sur resetPasswordSchema (6 chiffres, mot de passe ≥ 8).
  const isValid = /^\d{6}$/.test(code) && newPassword.length >= 8;

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { email, code, newPassword });
      Alert.alert(
        'Mot de passe réinitialisé',
        'Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.',
        [{ text: 'Se connecter', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch (e: any) {
      setError(e.message || 'Code invalide ou expiré');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
      >
        <TouchableOpacity onPress={() => router.back()} className="absolute top-12 left-6">
          <Ionicons name="arrow-back" size={26} color="#111827" />
        </TouchableOpacity>

        <View className="mb-10">
          <Text className="text-4xl font-extrabold text-blue-600 tracking-tight">
            Nouveau mot de passe
          </Text>
          <Text className="text-lg text-gray-500 mt-3 font-medium">
            Saisissez le code envoyé à {email || 'votre email'} et choisissez un nouveau
            mot de passe.
          </Text>
        </View>

        {error && (
          <View className="bg-red-50 p-4 rounded-xl mb-6 border border-red-100 flex-row items-center">
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
            <Text className="text-red-500 ml-2 font-medium flex-1">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-bold text-gray-700 mb-2 ml-1">Code de vérification</Text>
        <TextInput
          placeholder="123456"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          className="w-full h-14 border border-gray-200 bg-gray-50 rounded-2xl px-5 text-gray-900 text-2xl tracking-[8px] font-bold"
        />

        <Text className="text-sm font-bold text-gray-700 mb-2 ml-1 mt-5">
          Nouveau mot de passe
        </Text>
        <View className="relative">
          <TextInput
            placeholder="••••••••"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showPassword}
            className="w-full h-14 border border-gray-200 bg-gray-50 rounded-2xl px-5 pr-12 text-gray-900 text-base"
          />
          <Pressable onPress={() => setShowPassword(!showPassword)} className="absolute right-4 top-4">
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color="#9CA3AF" />
          </Pressable>
        </View>
        <Text className="text-gray-400 text-xs mt-1 ml-1">Au moins 8 caractères.</Text>

        <TouchableOpacity
          onPress={onSubmit}
          disabled={loading || !isValid}
          className={`w-full h-15 rounded-2xl justify-center items-center mt-10 ${
            loading || !isValid ? 'bg-blue-300' : 'bg-blue-600'
          }`}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-lg font-bold">Réinitialiser</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.replace('/(auth)/forgot-password')}
          className="mt-8 items-center"
        >
          <Text className="text-gray-500 font-medium">Je n'ai pas reçu de code</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
