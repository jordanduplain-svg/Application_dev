import { Ionicons } from '@expo/vector-icons';
import { Link, Tabs } from 'expo-router';
import { Pressable } from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

/**
 * Layout de la navigation par onglets de l'app authentifiée :
 * Dashboard, Campagnes, Réponses et Profil.
 */
export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Ionicons name="stats-chart" size={28} color={color} />,
          headerRight: () => (
            <Link href="/modal" asChild>
              <Pressable style={{ marginRight: 15 }}>
                {({ pressed }) => (
                  <Ionicons
                    name="information-circle-outline"
                    size={25}
                    color={Colors[colorScheme].text}
                    style={{ opacity: pressed ? 0.5 : 1 }}
                  />
                )}
              </Pressable>
            </Link>
          ),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: 'Campagnes',
          tabBarIcon: ({ color }) => <Ionicons name="megaphone-outline" size={28} color={color} />,
        }}
      />
      <Tabs.Screen
        name="responses"
        options={{
          title: 'Réponses',
          tabBarIcon: ({ color }) => <Ionicons name="mail-unread-outline" size={28} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={28} color={color} />,
        }}
      />
    </Tabs>
  );
}
