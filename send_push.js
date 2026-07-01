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
  'mailto:srikanthsajja3@gmail.com', // Contact email
  vapidPublicKey,
  vapidPrivateKey
);

async function runNotificationCheck() {
  console.log('Starting push notification cron check...');
  
  // A. Fetch all pending movements
  const { data: movements, error: movementsError } = await supabase
    .from('planned_movements')
    .select('*')
    .eq('status', 'pending');

  if (movementsError) {
    console.error('Error fetching planned movements:', movementsError);
    return;
  }

  if (!movements || movements.length === 0) {
    console.log('No pending movements found.');
    return;
  }

  // B. Fetch all push subscriptions
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

  console.log(`Checking ${movements.length} movements against ${subscriptions.length} subscriptions...`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const item of movements) {
    const dueDate = new Date(item.due_date);
    dueDate.setHours(0, 0, 0, 0);

    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Check if within reminder window
    if (diffDays >= 0 && diffDays <= item.reminder_days_before) {
      // Check if already notified today
      const lastNotified = item.last_notified_at ? new Date(item.last_notified_at) : null;
      const alreadyNotifiedToday = lastNotified && lastNotified.toDateString() === today.toDateString();

      if (alreadyNotifiedToday) {
        console.log(`Skipping "${item.title}" - already notified today.`);
        continue;
      }

      const typeLabel = item.type === 'subscription' ? 'Subscription' : item.type === 'debt_taken' ? 'Return' : 'Collect';
      const notificationPayload = JSON.stringify({
        title: `FinControl: ${typeLabel} Due`,
        body: `${item.title} (₹${Number(item.amount).toLocaleString()}) is due ${diffDays === 0 ? 'today' : 'in ' + diffDays + ' day(s)'}!`,
      });

      console.log(`Sending push notifications for "${item.title}"...`);

      let sendSuccess = false;

      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(sub.subscription, notificationPayload);
          sendSuccess = true;
          console.log(`Successfully sent push to subscription ID: ${sub.id}`);
        } catch (pushErr) {
          console.error(`Error sending push to subscription ID: ${sub.id}`, pushErr.statusCode);
          // If subscription has expired or is invalid, remove it
          if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
            console.log(`Removing expired/invalid subscription ID: ${sub.id}`);
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
          }
        }
      }

      if (sendSuccess) {
        // Update database to note we notified today
        const { error: updateError } = await supabase
          .from('planned_movements')
          .update({ last_notified_at: new Date().toISOString() })
          .eq('id', item.id);
        
        if (updateError) {
          console.error(`Failed to update last_notified_at for ${item.title}:`, updateError);
        }
      }
    }
  }

  console.log('Push notification check complete.');
}

runNotificationCheck().catch(err => {
  console.error('Fatal error during push check:', err);
});
