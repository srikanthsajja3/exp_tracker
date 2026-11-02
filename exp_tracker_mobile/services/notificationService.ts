import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure default notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const registerForPushNotificationsAsync = async (): Promise<string | undefined> => {
  if (Platform.OS === 'web') {
    // Web requires VAPID key for Expo Push Tokens; skip gracefully on web
    return undefined;
  }

  let token: string | undefined;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2563EB',
    });
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Notification permissions not granted');
      return undefined;
    }

    const pushTokenData = await Notifications.getExpoPushTokenAsync();
    token = pushTokenData.data;
  } catch (error) {
    console.log('Push notifications not available on this environment');
  }

  return token;
};

export const scheduleLocalNotification = async (
  title: string,
  body: string,
  triggerSeconds?: number
) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: triggerSeconds
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: triggerSeconds,
          }
        : null,
    });
  } catch (err) {
    console.log('Local notification scheduling skipped:', err);
  }
};
