import React from 'react';
import { View, Animated } from 'react-native';

/**
 * Composants de « squelette » de chargement (placeholders animés affichés
 * pendant le chargement des données, pour une UX plus fluide).
 */

// Bloc gris à l'opacité pulsée, brique de base des écrans de chargement.
export const Skeleton = ({ width, height, borderRadius = 8, className = "" }: { width?: any, height?: any, borderRadius?: number, className?: string }) => {
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // On conserve la référence de l'animation pour pouvoir l'ARRÊTER au
    // démontage : sinon la boucle continue de tourner en arrière-plan.
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View 
      style={{ 
        width, 
        height, 
        borderRadius, 
        opacity,
        backgroundColor: '#E5E7EB'
      }} 
      className={className}
    />
  );
};

// Squelette complet du tableau de bord (affiché pendant le chargement initial).
export const DashboardSkeleton = () => {
  return (
    <View className="px-6 py-8 bg-gray-50 flex-1">
      <Skeleton width="60%" height={32} className="mb-2" />
      <Skeleton width="80%" height={20} className="mb-10" />
      
      <View className="flex-row flex-wrap justify-between">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <View key={i} className="w-[48%] bg-white p-5 rounded-3xl mb-4 border border-gray-100">
            <Skeleton width="60%" height={14} className="mb-3" />
            <Skeleton width="40%" height={28} />
          </View>
        ))}
      </View>
      
      <View className="mt-10">
        <Skeleton width="40%" height={24} className="mb-4" />
        <View className="bg-white p-6 rounded-2xl border border-gray-100">
           <Skeleton width="80%" height={22} className="mb-2" />
           <Skeleton width="60%" height={16} />
        </View>
      </View>
    </View>
  );
};
