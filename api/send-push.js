import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

webpush.setVapidDetails(
  'mailto:srikanthsajja3@gmail.com',
  vapidPublicKey,
  vapidPrivateKey
);

// Helper to get current date/time components in a specific timezone
function getLocalTimeComponents(timezone) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const components = {};
    parts.forEach(p => { components[p.type] = p.value; });
    
    // YYYY-MM-DD
    const dateString = `${components.year}-${components.month}-${components.day}`;
    // HH:MM
    const timeString = `${components.hour}:${components.minute}`;
    
    return { 
      dateString, 
      timeString, 
      hour: parseInt(components.hour, 10), 
      minute: parseInt(components.minute, 10) 
    };
  } catch (err) {
    // Fallback to IST if timezone is invalid
    console.error(`Timezone formatting failed for ${timezone}:`, err);
    return getLocalTimeComponents('Asia/Kolkata');
  }
}

// Helper to check if a past date is "today" in a given timezone
function isTodayInTimezone(dateToCheck, timezone, currentDateString) {
  if (!dateToCheck) return false;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date(dateToCheck));
    const components = {};
    parts.forEach(p => { components[p.type] = p.value; });
    const formattedDate = `${components.year}-${components.month}-${components.day}`;
    return formattedDate === currentDateString;
  } catch (err) {
    return false;
  }
}

export default async function handler(req, res) {
  try {
    // A. Fetch all active subscriptions
    const { data: subscriptions, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('*');

    if (subsError) throw subsError;
    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({ message: 'No registered push subscriptions found.' });
    }

    // B. Fetch all pending movements
    const { data: movements, error: movementsError } = await supabase
      .from('planned_movements')
      .select('*')
      .eq('status', 'pending');

    // C. Fetch all custom general reminders
    const { data: generalReminders, error: remindersError } = await supabase
      .from('general_reminders')
      .select('*');

    let totalNotificationsSent = 0;

    // Loop through each subscription to customize delivery timezone
    for (const sub of subscriptions) {
      const tz = sub.timezone || 'Asia/Kolkata';
      const localTime = getLocalTimeComponents(tz);

      // --- 1. CHECK PLANNED MOVEMENTS (Daily check at 10:00 AM Local Time) ---
      if (localTime.hour === 10 && !movementsError && movements && movements.length > 0) {
        for (const item of movements) {
          const dueDate = new Date(item.due_date);
          dueDate.setHours(0, 0, 0, 0);

          // Get today's local date
          const localToday = new Date();
          localToday.setHours(0, 0, 0, 0);
          
          const diffTime = dueDate.getTime() - localToday.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays >= 0 && diffDays <= item.reminder_days_before) {
            // Check if notified today in target timezone
            const alreadyNotified = isTodayInTimezone(item.last_notified_at, tz, localTime.dateString);
            if (alreadyNotified) continue;

            const typeLabel = item.type === 'subscription' ? 'Subscription' : item.type === 'debt_taken' ? 'Return' : 'Collect';
            const payload = JSON.stringify({
              title: `FinControl: ${typeLabel} Due`,
              body: `${item.title} (₹${Number(item.amount).toLocaleString()}) is due ${diffDays === 0 ? 'today' : 'in ' + diffDays + ' day(s)'}!`,
            });

            try {
              await webpush.sendNotification(sub.subscription, payload);
              totalNotificationsSent++;

              // Update DB to mark notified
              await supabase
                .from('planned_movements')
                .update({ last_notified_at: new Date().toISOString() })
                .eq('id', item.id);
            } catch (pushErr) {
              if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                break; // Break subscription loop for this subscription
              }
            }
          }
        }
      }

      // --- 2. CHECK GENERAL REMINDERS (Hourly check) ---
      if (!remindersError && generalReminders && generalReminders.length > 0) {
        for (const rem of generalReminders) {
          if (rem.type === 'daily') {
            // Check if time matches current hour (format: 'HH:MM:SS' or 'HH:MM')
            const remHour = parseInt(rem.reminder_time.substring(0, 2), 10);
            if (remHour === localTime.hour) {
              // Check if notified today
              const alreadyNotified = isTodayInTimezone(rem.last_notified_at, tz, localTime.dateString);
              if (alreadyNotified) continue;

              const payload = JSON.stringify({
                title: rem.title,
                body: rem.body,
              });

              try {
                await webpush.sendNotification(sub.subscription, payload);
                totalNotificationsSent++;

                // Mark notified
                await supabase
                  .from('general_reminders')
                  .update({ last_notified_at: new Date().toISOString() })
                  .eq('id', rem.id);
              } catch (pushErr) {
                if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                  await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                  break;
                }
              }
            }
          } else if (rem.type === 'one-off') {
            // Check if date and hour match
            const remDate = rem.reminder_date; // YYYY-MM-DD
            const remHour = parseInt(rem.reminder_time.substring(0, 2), 10);
            
            if (remDate === localTime.dateString && remHour === localTime.hour) {
              // Check if already notified
              if (rem.last_notified_at) continue;

              const payload = JSON.stringify({
                title: rem.title,
                body: rem.body,
              });

              try {
                await webpush.sendNotification(sub.subscription, payload);
                totalNotificationsSent++;

                // Mark notified
                await supabase
                  .from('general_reminders')
                  .update({ last_notified_at: new Date().toISOString() })
                  .eq('id', rem.id);
              } catch (pushErr) {
                if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                  await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                  break;
                }
              }
            }
          }
        }
      }
    }

    return res.status(200).json({ message: `Hourly check complete. Sent ${totalNotificationsSent} notification(s).` });
  } catch (error) {
    console.error('Error running hourly check:', error);
    return res.status(500).json({ error: error.message });
  }
}
