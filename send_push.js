import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// 1. Manually parse .env to populate process.env
try {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    env.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim().replace(/(^['"]|['"]$)/g, '');
        if (key && value) {
          process.env[key] = value;
        }
      }
    });
  }
} catch (e) {
  console.error('Error loading .env file:', e);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !vapidPublicKey || !vapidPrivateKey) {
  console.error('Missing configuration variables in environment / .env file.');
  process.exit(1);
}

// 2. Initialize Supabase and Web Push
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
    
    const dateString = `${components.year}-${components.month}-${components.day}`;
    const timeString = `${components.hour}:${components.minute}`;
    
    return { 
      dateString, 
      timeString, 
      hour: parseInt(components.hour, 10), 
      minute: parseInt(components.minute, 10) 
    };
  } catch (err) {
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

async function runNotificationCheck() {
  console.log('Starting push notification cron check...');
  
  // A. Fetch all active subscriptions
  const { data: subscriptions, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('*');

  if (subsError) {
    console.error('Error fetching push subscriptions:', subsError);
    return;
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log('No registered push subscriptions found.');
    return;
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

  for (const sub of subscriptions) {
    const tz = sub.timezone || 'Asia/Kolkata';
    const localTime = getLocalTimeComponents(tz);
    console.log(`Checking device subscription ${sub.id} (Timezone: ${tz}, Local Time: ${localTime.dateString} ${localTime.timeString})`);

    // --- 1. CHECK PLANNED MOVEMENTS (Daily check at 10:00 AM Local Time) ---
    // Note: If running manually, we bypass the 10:00 AM constraint to allow immediate testing.
    const isManualRun = process.argv.includes('--force') || process.argv.includes('-f');
    const isCheckTime = localTime.hour === 10 || isManualRun;

    if (isCheckTime && !movementsError && movements && movements.length > 0) {
      for (const item of movements) {
        const dueDate = new Date(item.due_date);
        dueDate.setHours(0, 0, 0, 0);

        const localToday = new Date();
        localToday.setHours(0, 0, 0, 0);
        
        const diffTime = dueDate.getTime() - localToday.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= item.reminder_days_before) {
          const alreadyNotified = isTodayInTimezone(item.last_notified_at, tz, localTime.dateString);
          if (alreadyNotified && !isManualRun) continue;

          const typeLabel = item.type === 'subscription' ? 'Subscription' : item.type === 'debt_taken' ? 'Return' : 'Collect';
          const payload = JSON.stringify({
            title: `FinControl: ${typeLabel} Due`,
            body: `${item.title} (₹${Number(item.amount).toLocaleString()}) is due ${diffDays === 0 ? 'today' : 'in ' + diffDays + ' day(s)'}!`,
          });

          try {
            console.log(`Sending planned movement push for "${item.title}" to device...`);
            await webpush.sendNotification(sub.subscription, payload);
            totalNotificationsSent++;

            await supabase
              .from('planned_movements')
              .update({ last_notified_at: new Date().toISOString() })
              .eq('id', item.id);
          } catch (pushErr) {
            console.error(`Push failed:`, pushErr.statusCode);
            if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
              await supabase.from('push_subscriptions').delete().eq('id', sub.id);
              break;
            }
          }
        }
      }
    }

    // --- 2. CHECK GENERAL REMINDERS (Hourly check) ---
    if (!remindersError && generalReminders && generalReminders.length > 0) {
      for (const rem of generalReminders) {
        if (rem.type === 'daily') {
          const remHour = parseInt(rem.reminder_time.substring(0, 2), 10);
          const hourMatches = remHour === localTime.hour || isManualRun;
          
          if (hourMatches) {
            const alreadyNotified = isTodayInTimezone(rem.last_notified_at, tz, localTime.dateString);
            if (alreadyNotified && !isManualRun) continue;

            const payload = JSON.stringify({
              title: rem.title,
              body: rem.body,
            });

            try {
              console.log(`Sending daily custom reminder "${rem.title}" to device...`);
              await webpush.sendNotification(sub.subscription, payload);
              totalNotificationsSent++;

              await supabase
                .from('general_reminders')
                .update({ last_notified_at: new Date().toISOString() })
                .eq('id', rem.id);
            } catch (pushErr) {
              console.error(`Push failed:`, pushErr.statusCode);
              if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                break;
              }
            }
          }
        } else if (rem.type === 'one-off') {
          const remDate = rem.reminder_date;
          const remHour = parseInt(rem.reminder_time.substring(0, 2), 10);
          const isMatch = (remDate === localTime.dateString && remHour === localTime.hour) || isManualRun;
          
          if (isMatch) {
            if (rem.last_notified_at && !isManualRun) continue;

            const payload = JSON.stringify({
              title: rem.title,
              body: rem.body,
            });

            try {
              console.log(`Sending one-time custom reminder "${rem.title}" to device...`);
              await webpush.sendNotification(sub.subscription, payload);
              totalNotificationsSent++;

              await supabase
                .from('general_reminders')
                .update({ last_notified_at: new Date().toISOString() })
                .eq('id', rem.id);
            } catch (pushErr) {
              console.error(`Push failed:`, pushErr.statusCode);
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

  console.log(`Push notification check complete. Sent ${totalNotificationsSent} notifications.`);
}

runNotificationCheck().catch(err => {
  console.error('Fatal error during push check:', err);
});
